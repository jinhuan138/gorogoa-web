const f=Math.fround;

/** _Component.GetAttribute(Color): packed signed ARGB, then Color32 -> Color. */
export function hazeColor(attrs={}) {
  const value=Number(attrs.hazeColor??0)>>>0;
  return [f(((value>>>16)&255)/255),f(((value>>>8)&255)/255),f((value&255)/255),f(Number(attrs.hazeAmount||0))];
}

/** Original HazeColour.Accumulate, including its unnormalised RGB accumulation. */
export function accumulateHaze(a=[0,0,0,0],b=[0,0,0,0]) {
  if(a[3]===0)return [...b];
  if(b[3]===0)return [...a];
  const inverse=f(1-b[3]);
  return [0,1,2].map(i=>f(f(a[i]*inverse)+f(b[i]*b[3]))).concat(f(1-f(f(1-a[3])*inverse)));
}

/** ParallaxEngine.AccumulateHaze recurses through m_children, not shadow sources. */
export function hazeDrawList(items,color,recurse=false) {
  if(color[3]===0)return;
  for(const item of items){item.haze=accumulateHaze(item.haze,color);if(recurse&&item.children)hazeDrawList(item.children,color,true);}
}

/** D3D11 UI shader: output.rgb = sample.rgb*(1-haze.a) + haze.rgb*haze.a. */
export function paintHaze(context,color,width,height) {
  if(!color?.[3])return;
  context.save();context.globalCompositeOperation='source-atop';context.globalAlpha=color[3];
  context.fillStyle=`rgb(${color.slice(0,3).map(v=>v*255).join(',')})`;
  context.fillRect(0,0,width,height);context.restore();
}
