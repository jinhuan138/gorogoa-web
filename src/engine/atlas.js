export function normalizeSource(filename) {
  let value=String(filename||'').replaceAll('\\','/');
  const index=value.toLocaleLowerCase().lastIndexOf('/assets/'); if(index>=0) value=value.slice(index+8);
  return value.replace(/\.png$/i,'').replace(/^\/+/, '').toLocaleLowerCase();
}
export class AtlasStore {
  constructor(manifest,atlases,{baseUrl=globalThis.document?.baseURI,maxCachedTextures=16}={}) {
    this.baseUrl=baseUrl; this.textures=new Map(manifest.textures.map(t=>[t.key,t]));this.regions=new Map();this.images=new Map();this.active=new Set();this.lastUsed=new Map();this.cacheTick=0;this.maxCachedTextures=maxCachedTextures;
    for(const region of atlases.entries) {const key=normalizeSource(region.source);const entries=this.regions.get(key)||[];entries.push(region);this.regions.set(key,entries);}
  }
  find(filename) {const found=this.regions.get(normalizeSource(filename))||[];if(found.length===1)return found[0];if(found.length>1)throw new Error(`素材引用多义: ${filename}`);return undefined;}
  retainActive(urls){this.active=new Set(urls);this.prune();}
  prune(){const removable=[...this.images.keys()].filter(url=>!this.active.has(url)).sort((a,b)=>(this.lastUsed.get(a)||0)-(this.lastUsed.get(b)||0));for(const url of removable){if(this.images.size<=this.maxCachedTextures)break;this.images.delete(url);this.lastUsed.delete(url);}}
  image(region) {
    if(!this.baseUrl) return Promise.reject(new Error('缺少图片根URL'));
    let pending=this.images.get(region.textureUrl);
    if(!pending) {pending=(async()=>{const image=new Image();image.src=new URL(region.textureUrl,this.baseUrl).href;await image.decode();return image;})();this.images.set(region.textureUrl,pending);pending.catch(()=>this.images.delete(region.textureUrl));}
    this.lastUsed.set(region.textureUrl,++this.cacheTick);this.prune();return pending;
  }
  crop(region) {const texture=this.textures.get(region.textureKey);if(!texture)throw new Error(`缺少图集: ${region.textureKey}`);return [region.u,texture.height-region.v-region.h,region.w,region.h];}
}

