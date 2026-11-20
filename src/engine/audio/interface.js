// PC SoundEffect 序列化配置；APK 原生 Start/Play 与 Startup 的 4 个音源确认播放规则。
export const INTERFACE_EFFECTS = {
    menu: {
        clips: [119, 123, 127, 125, 130, 128, 122],
        pitch: [0.8, 1.2],
        volume: [0.7, 0.7],
    },
    slide: { clips: [132], pitch: [0.8, 0.8], volume: [0.4, 0.4] },
    back: { clips: [117, 116, 121, 126], pitch: [0.95, 1.1], volume: [0.3, 0.3] },
    // 原版 Select_02 占两个位置，不能去重。
    select: {
        clips: [124, 118, 118, 131],
        pitch: [0.95, 1.1],
        volume: [0.3, 0.3],
    },
    nonInteractive: { clips: [115], pitch: [1, 1], volume: [0.1, 0.1] },
    ping: { clips: [129], pitch: [1, 1], volume: [0.3, 0.3] },
};

/** 独立界面音效池，不随游戏音乐暂停；各操作共享原版 SoundEffect 的循环索引。 */
export class InterfaceSounds {
    constructor(bank, random = Math.random) {
        this.bank = bank;
        this.random = random;
        this.enabled = false;
        this.disposed = false;
        this.slots = new Set();
        this.sliders = new Map();
        this.effects = new Map();
        for (const [name, definition] of Object.entries(INTERFACE_EFFECTS)) {
            const clips = [...definition.clips];
            for (let n = clips.length; n > 1; n--) {
                const index = Math.floor(random() * n);
                [clips[n - 1], clips[index]] = [clips[index], clips[n - 1]];
            }
            this.effects.set(name, { ...definition, clips, index: 0 });
        }
    }

    setEnabled(enabled) {
        this.enabled = enabled && !this.disposed;
        if (!this.enabled) this.stop();
    }

    async play(name, { channel = "effects", shouldPlay = () => true } = {}) {
        if (
            !this.enabled ||
            this.bank.context?.state !== "running" ||
            this.slots.size >= 4
        )
            return null;
        const effect = this.effects.get(name);
        if (!effect) return null;
        const clip = effect.clips[effect.index];
        effect.index = (effect.index + 1) % effect.clips.length;
        const range = ([min, max]) => min + (max - min) * this.random();
        // 解码中的请求也占位，避免快速点击突破音源上限。
        const slot = { handle: null };
        this.slots.add(slot);
        try {
            const handle = await this.bank.play(`sharedassets0.assets/${clip}`, {
                playbackRate: range(effect.pitch),
                volume: range(effect.volume),
                channel,
                shouldPlay: () =>
                    this.enabled &&
                    this.bank.context?.state === "running" &&
                    this.slots.has(slot) &&
                    shouldPlay(),
                onEnd: () => this.slots.delete(slot),
            });
            if (!this.slots.has(slot)) {
                handle?.stop();
                return null;
            }
            if (!handle) this.slots.delete(slot);
            else slot.handle = handle;
            return handle;
        } catch (error) {
            const active = this.slots.delete(slot);
            if (active) console.warn("界面音效未播放", error);
            return null;
        }
    }

    initializeSlider(channel, value) {
        this.sliders.set(channel, { value, time: 0 });
    }

    adjustVolume(channel, value, time) {
        const previous = this.sliders.get(channel);
        // VolumeSlider：变化阈值或时间间隔任一满足即反馈，不为每个 input 播放。
        if (Math.abs(value - previous.value) < 0.1 && time - previous.time < 1)
            return;
        this.sliders.set(channel, { value, time });
        return this.play("slide", { channel });
    }

    stop() {
        const slots = [...this.slots];
        this.slots.clear();
        for (const slot of slots) slot.handle?.stop();
    }

    async dispose() {
        this.disposed = true;
        this.setEnabled(false);
        await this.bank.context?.close();
    }
}
