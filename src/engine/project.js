/** 原版 XML 的无损逻辑树索引；不推断谓词、渲染或状态语义。 */
export class ProjectModel {
  constructor(tree) {
    this.tree = tree;
    this.byGuid = new Map();
    this.byGuidAll = new Map();
    this.duplicates = new Map();
    this.parent = new WeakMap();
    this.nodesByType = new Map();
    const pending = [{ node: tree, parent: null }];
    while (pending.length) {
      const { node, parent } = pending.pop();
      if (!node || typeof node !== 'object' || typeof node.type !== 'string' || !node.attrs || !Array.isArray(node.children)) throw new TypeError('项目节点必须包含 type、attrs 和 children');
      if (this.parent.has(node)) throw new TypeError('项目树不能复用节点或包含循环');
      this.parent.set(node, parent);
      const typed = this.nodesByType.get(node.type) || [];
      typed.push(node); this.nodesByType.set(node.type, typed);
      const guid = node.attrs.guid;
      if (guid) {
        const matches = this.byGuidAll.get(guid) || [];
        matches.push(node); this.byGuidAll.set(guid, matches);
      }
      for (let i = node.children.length - 1; i >= 0; i--) pending.push({ node: node.children[i], parent: node });
    }
    for (const [type, nodes] of this.nodesByType) this.nodesByType.set(type, Object.freeze(nodes));
    for (const [guid, nodes] of this.byGuidAll) {
      Object.freeze(nodes);
      if (nodes.length === 1) this.byGuid.set(guid, nodes[0]);
      else this.duplicates.set(guid, nodes);
    }
  }

  /** 多义 GUID 必须限定在所属子树；仍然多义时返回 undefined。 */
  get(guid, within) {
    if (!within) return this.byGuid.get(guid);
    const matches = (this.byGuidAll.get(guid) || []).filter(node => this.contains(within, node));
    return matches.length === 1 ? matches[0] : undefined;
  }

  getAll(guid) { return this.byGuidAll.get(guid) || []; }
  all(type) { return this.nodesByType.get(type) || []; }
  direct(node, type) { return (node?.children || []).filter(child => !type || child.type === type); }
  container(node, containerName, itemType) { return this.direct(node, containerName).flatMap(container => this.direct(container, itemType)); }

  /** 返回最近的祖先（不包含节点自身）。 */
  owner(node, type) {
    let current = this.parent.get(node);
    while (current) { if (current.type === type) return current; current = this.parent.get(current); }
    return undefined;
  }

  contains(ancestor, node) {
    let current = node;
    while (current) { if (current === ancestor) return true; current = this.parent.get(current); }
    return false;
  }

  text(node) { return this.direct(node, '#text').map(child => child.text || '').join(''); }
}

async function readRuntimeData(file, baseUrl) {
  if (!baseUrl) throw new TypeError('加载项目需要项目根 URL');
  const url = new URL(`assets/data/${file}`, baseUrl);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`无法加载 ${file} (${response.status})`);
  return response.json();
}

export async function loadChapterCheckpoint(chapter, baseUrl = globalThis.document?.baseURI) {
  if (chapter !== 'end' && (!Number.isInteger(chapter) || chapter < 1 || chapter > 5)) throw new RangeError('章节检查点编号必须为 1 至 5 或 end');
  const name = chapter === 'end' ? 'end' : `chapter${chapter}`;
  const checkpoint = await readRuntimeData(`runtime-${name}-save.json`, baseUrl);
  if (checkpoint?.type !== 'GameSaveData') throw new TypeError('章节检查点存档类型不符');
  return checkpoint;
}

export async function loadProject(baseUrl = globalThis.document?.baseURI) {
  const [tree, chapter1Save] = await Promise.all([readRuntimeData('runtime-project.json', baseUrl), loadChapterCheckpoint(1, baseUrl)]);
  if (tree?.type !== 'project') throw new TypeError('项目类型不符');
  return { project: new ProjectModel(tree), chapter1Save };
}

