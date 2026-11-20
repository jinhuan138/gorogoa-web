import { expect, test, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { AudioBank } from "../src/engine/audio/audio.js";
import {
    InterfaceSounds,
    INTERFACE_EFFECTS,
} from "../src/engine/audio/interface.js";

function player({ deferred = false, random = () => 0 } = {}) {
    const calls = [];
    const bank = {
        context: { state: "running", close: vi.fn() },
        play: vi.fn((name, options) => {
            const call = { name, options, handle: null };
            calls.push(call);
            const finish = () => {
                if (!options.shouldPlay()) return null;
                call.handle = { stop: vi.fn(() => options.onEnd()) };
                return call.handle;
            };
            if (deferred)
                return new Promise((resolve) => {
                    call.release = () => resolve(finish());
                });
            return Promise.resolve(finish());
        }),
    };
    const sounds = new InterfaceSounds(bank, random);
    sounds.setEnabled(true);
    return { sounds, bank, calls };
}

test("配置对应现有素材，保留 Select 重复位置与原版直接音量", async () => {
    const manifest = JSON.parse(
        await readFile("public/assets/audio/manifest.json", "utf8"),
    );
    const keys = new Set(manifest.clips.map((clip) => clip.key));
    for (const effect of Object.values(INTERFACE_EFFECTS))
        for (const clip of effect.clips)
            expect(keys.has(`sharedassets0.assets/${clip}`)).toBe(true);
    expect(INTERFACE_EFFECTS.select.clips).toEqual([124, 118, 118, 131]);
    const { sounds, calls } = player({ random: () => 0.5 });
    await sounds.play("menu");
    expect(calls[0].options.volume).toBe(0.7);
    expect(calls[0].options.playbackRate).toBe(1);
    calls[0].options.onEnd();
    await sounds.play("select");
    expect(calls[1].options.playbackRate).toBeCloseTo(1.025);
    expect(calls[1].options.volume).toBe(0.3);
});

test("只洗牌一次，播放到末尾循环，不在每轮重新随机", async () => {
    const random = vi.fn(() => 0);
    const { sounds, calls } = player({ random });
    expect(random).toHaveBeenCalledTimes(12);
    for (let i = 0; i < 14; i++) {
        await sounds.play("menu");
        calls.at(-1).options.onEnd();
    }
    const names = calls.map((call) => call.name);
    expect(names.slice(0, 7)).toEqual(
        [123, 127, 125, 130, 128, 122, 119].map(
            (id) => `sharedassets0.assets/${id}`,
        ),
    );
    expect(names.slice(7)).toEqual(names.slice(0, 7));
    expect(random).toHaveBeenCalledTimes(12 + 14 * 2);
    sounds.stop();
    expect(sounds.effects.get("menu").index).toBe(0);
});

test("4 个音源含 pending 占位，满池不抢占，结束后可继续", async () => {
    const { sounds, calls, bank } = player({ deferred: true });
    const pending = Array.from({ length: 4 }, () => sounds.play("menu"));
    const index = sounds.effects.get("menu").index;
    await sounds.play("menu");
    expect(bank.play).toHaveBeenCalledTimes(4);
    expect(sounds.effects.get("menu").index).toBe(index);
    for (const call of calls) call.release();
    await Promise.all(pending);
    await sounds.play("back");
    expect(bank.play).toHaveBeenCalledTimes(4);
    for (const call of calls) expect(call.handle.stop).not.toHaveBeenCalled();
    calls[0].options.onEnd();
    const next = sounds.play("back");
    expect(bank.play).toHaveBeenCalledTimes(5);
    calls[4].release();
    await next;
});

test("静音、重启和销毁取消 pending；重新启用不补播旧请求", async () => {
    const { sounds, calls, bank } = player({ deferred: true });
    const muted = sounds.play("select");
    sounds.setEnabled(false);
    sounds.setEnabled(true);
    calls[0].release();
    expect(await muted).toBeNull();
    const restarted = sounds.play("menu");
    sounds.stop();
    calls[1].release();
    expect(await restarted).toBeNull();
    const disposed = sounds.play("back");
    await sounds.dispose();
    calls[2].release();
    expect(await disposed).toBeNull();
    sounds.setEnabled(true);
    expect(await sounds.play("menu")).toBeNull();
    expect(bank.context.close).toHaveBeenCalledTimes(1);
    expect(sounds.slots.size).toBe(0);
});

test("播放失败释放音源，提示状态过期后不会响", async () => {
    const { sounds, calls, bank } = player({ deferred: true });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => { });
    bank.play.mockRejectedValueOnce(new Error("decode"));
    await sounds.play("ping");
    expect(sounds.slots.size).toBe(0);
    expect(warning).toHaveBeenCalledTimes(1);
    let visible = true;
    const pending = sounds.play("ping", { shouldPlay: () => visible });
    visible = false;
    calls[0].release();
    expect(await pending).toBeNull();
    expect(sounds.slots.size).toBe(0);
});

test("滑块按变化阈值或 1 秒间隔反馈，分别路由音乐与音效通道", async () => {
    const { sounds, calls } = player();
    sounds.initializeSlider("music", 0);
    sounds.initializeSlider("effects", 0);
    await sounds.adjustVolume("music", 0.03, 0.2);
    await sounds.adjustVolume("music", 0.06, 0.4);
    expect(calls).toHaveLength(0);
    await sounds.adjustVolume("music", 0.1, 0.5);
    expect(calls[0].options.channel).toBe("music");
    expect(calls[0].options.volume).toBe(0.4);
    expect(calls[0].options.playbackRate).toBe(0.8);
    calls[0].options.onEnd();
    await sounds.adjustVolume("music", 0.11, 1.4);
    expect(calls).toHaveLength(1);
    await sounds.adjustVolume("music", 0.12, 1.5);
    expect(calls).toHaveLength(2);
    await sounds.adjustVolume("effects", 0.2, 0.6);
    expect(calls[2].options.channel).toBe("effects");
    sounds.setEnabled(false);
    expect(calls[0].handle.stop).not.toHaveBeenCalled();
    for (const call of calls.slice(1))
        expect(call.handle.stop).toHaveBeenCalledTimes(1);
});

test("复用 AudioBank 解码缓存、音量通道与 shouldPlay，不重新下载同一音效", async () => {
    const output = () => ({
        gain: { value: 1, setTargetAtTime: vi.fn() },
        connect: vi.fn(),
        disconnect: vi.fn(),
    });
    const sources = [];
    const context = {
        state: "running",
        currentTime: 0,
        destination: {},
        close: vi.fn(),
        createGain: vi.fn(output),
        createBufferSource: vi.fn(() => {
            const source = {
                playbackRate: { value: 1 },
                connect: vi.fn(),
                disconnect: vi.fn(),
                start: vi.fn(),
                stop: vi.fn(),
            };
            sources.push(source);
            return source;
        }),
        decodeAudioData: vi.fn(async () => ({
            numberOfChannels: 2,
            length: 100,
            duration: 0.1,
        })),
    };
    const fetch = vi.fn(
        async (url) =>
            new Response(
                new URL(url).pathname.endsWith("manifest.json")
                    ? JSON.stringify({
                        clips: [
                            {
                                key: "sharedassets0.assets/132",
                                name: "UI_Menu_Slide_02",
                                channels: 2,
                                dataSha256: "one",
                                url: "assets/audio/slide.ogg",
                            },
                        ],
                    })
                    : new Uint8Array([1, 2, 3]),
            ),
    );
    vi.stubGlobal("fetch", fetch);
    const bank = new AudioBank(context);
    const sounds = new InterfaceSounds(bank);
    bank.setChannelVolume("music", 0.35);
    sounds.setEnabled(true);
    await sounds.play("slide", { channel: "music" });
    expect(sources[0].playbackRate.value).toBe(0.8);
    expect(bank.channels.get("music").gain.value).toBe(0.35);
    sources[0].onended();
    await sounds.play("slide", { channel: "effects" });
    expect(context.decodeAudioData).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    bank.setChannelVolume("effects", 0);
    expect(
        bank.channels.get("effects").gain.setTargetAtTime,
    ).toHaveBeenCalledWith(0, 0, 0.015);
    await sounds.dispose();
    expect(sources[1].stop).toHaveBeenCalledTimes(1);
});
