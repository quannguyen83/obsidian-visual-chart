'use strict';
const {Plugin, MarkdownRenderer, Notice} = require('obsidian');

function parseConfig(raw) {
  const cfg={title:'',depth:18,explode:6,hover:8,tilt:1,data:[]};
  let inData=false;
  for(const source of raw.split(/\r?\n/)){
    const line=source.trim();
    if(!line||line.startsWith('#')) continue;
    if(/^data\s*:\s*$/.test(line)){inData=true;continue;}
    const match=line.match(/^(?:"([^"]+)"|'([^']+)'|([^:]+))\s*:\s*(.*?)\s*$/);
    if(!match) throw new Error('Invalid line: '+line);
    const key=(match[1]||match[2]||match[3]).trim();
    const value=match[4].replace(/^['"]|['"]$/g,'').trim();
    if(inData){
      const n=Number(value);
      if(!Number.isFinite(n)||n<=0)throw new Error('Data values must be positive numbers: '+key);
      cfg.data.push({label:key,value:n});
    }else if(key==='title')cfg.title=value;
    else if(['depth','explode','hover','tilt'].includes(key)){
      const n=Number(value);if(!Number.isFinite(n))throw new Error('Invalid '+key);
      cfg[key]=n;
    }else if(key==='type' && value!=='pie-3d')throw new Error('Only type: pie-3d is supported.');
  }
  if(cfg.data.length<2||cfg.data.length>16)throw new Error('Provide 2 to 16 data values under data:.');
  const total=cfg.data.reduce((a,d)=>a+d.value,0);
  if(total<=0)throw new Error('The data total must be positive.');
  cfg.depth=Math.max(0,Math.min(40,cfg.depth));
  cfg.explode=Math.max(0,Math.min(25,cfg.explode));
  cfg.hover=Math.max(0,Math.min(24,cfg.hover));
  cfg.tilt=Math.max(.3,Math.min(.85,cfg.tilt));
  return cfg;
}
const NS='http://www.w3.org/2000/svg';
function el(tag,attrs={},parent){
  const node=document.createElementNS(NS,tag);
  for(const [k,v] of Object.entries(attrs))node.setAttribute(k,String(v));
  if(parent)parent.appendChild(node); return node;
}
function darkenColor(hex, factor=.58) {
  const h=hex.replace('#','');
  const rgb=[0,2,4].map(i=>Math.round(parseInt(h.slice(i,i+2),16)*factor));
  return 'rgb('+rgb.join(',')+')';
}
function point(a,rx,ry){return [rx*Math.cos(a),ry*Math.sin(a)];}
function arc(a,b,rx,ry){
  const [sx,sy]=point(a,rx,ry),[ex,ey]=point(b,rx,ry);
  return 'M 0 0 L '+sx+' '+sy+' A '+rx+' '+ry+' 0 '+(b-a>Math.PI?1:0)+' 1 '+ex+' '+ey+' Z';
}
function sideSegments(a,b,rx,ry,depth){
  const parts=[];const step=Math.PI/80;
  // Only the front-facing arc is visible: sin(angle)>0.
  for(let at=a;at<b-1e-7;){
    const stop=Math.min(b,at+step);
    if(Math.sin((at+stop)/2)>0){
      const p=point(at,rx,ry),q=point(stop,rx,ry);
      parts.push('M '+p[0]+' '+p[1]+' L '+q[0]+' '+q[1]+' L '+q[0]+' '+(q[1]+depth)+' L '+p[0]+' '+(p[1]+depth)+' Z');
    }
    at=stop;
  }
  const edge=[];
  for(const angle of [a,b])if(Math.sin(angle)>0){const p=point(angle,rx,ry);edge.push('M 0 0 L '+p[0]+' '+p[1]+' L '+p[0]+' '+(p[1]+depth)+' L 0 '+depth+' Z');}
  return {parts,edge};
}
function render(source,host){
  host.empty();
  const cfg=parseConfig(source);
  host.addClass('visual-charts');
  if(cfg.title)host.createEl('div',{text:cfg.title,cls:'visual-charts-title'});
  const svg=el('svg',{viewBox:'0 0 560 475',role:'img','aria-label':cfg.title||'Interactive pie chart',class:'visual-charts-svg'},host);
  const tooltip=host.createDiv({cls:'visual-charts-tooltip'});
  tooltip.setAttribute('role','status');
  tooltip.setAttribute('aria-live','polite');
  const tipHeader=tooltip.createDiv({cls:'visual-charts-tooltip-header'});
  const tipDot=tipHeader.createSpan({cls:'visual-charts-tooltip-dot'});
  const tipName=tipHeader.createSpan({cls:'visual-charts-tooltip-name'});
  const tipMain=tooltip.createDiv({cls:'visual-charts-tooltip-main'});
  const tipPercent=tipMain.createSpan({cls:'visual-charts-tooltip-percent'});
  const tipValue=tipMain.createSpan({cls:'visual-charts-tooltip-value'});
  const showTip=(data,base,percent,event)=>{
    tipDot.style.backgroundColor=base;
    tooltip.style.setProperty('--tip-color',base);
    tipName.textContent=data.label;
    tipPercent.textContent=percent.toFixed(1)+'%';
    tipValue.textContent=data.value+' of '+total;
    tooltip.classList.add('is-visible');
    if(event)moveTip(event);
    else { tooltip.style.left='50%';tooltip.style.top='20px';tooltip.style.transform='translate(-50%,0)'; }
  };
  const moveTip=(event)=>{
    const rect=host.getBoundingClientRect();
    const x=Math.max(110,Math.min(rect.width-110,event.clientX-rect.left));
    const y=Math.max(12,event.clientY-rect.top-106);
    tooltip.style.left=x+'px';tooltip.style.top=y+'px';
    tooltip.style.transform='translate(-50%,0)';
  };
  const hideTip=()=>tooltip.classList.remove('is-visible');
  const colors=['#6e9fac','#e7af65','#aaa0d0','#83b49b','#d98781','#b7ad76','#6e8fcb','#c591b1'];
  const total=cfg.data.reduce((n,d)=>n+d.value,0),cx=280,cy=215,rx=166,ry=rx;
  let cursor=-Math.PI/2;
  const sliceGroups=[];
  cfg.data.forEach((data,index)=>{
    const span=data.value/total*Math.PI*2, start=cursor,end=cursor+span,mid=(start+end)/2;
    cursor=end;
    const base=colors[index%colors.length];
    const group=el('g',{class:'visual-charts-slice',tabindex:'0',role:'button','aria-label':data.label+': '+(100*data.value/total).toFixed(1)+'%'},svg);
    group.style.setProperty('--lift',cfg.hover+'px');
    group.setAttribute('transform','translate('+(cx+Math.cos(mid)*cfg.explode)+','+(cy+Math.sin(mid)*cfg.explode)+')');
    const moving=el('g',{class:'visual-charts-moving'},group);
    // One circular face; silhouette-based offset shadows create Yocto-style depth.
    // Do not duplicate radial slice edges: only the outer silhouette casts depth.
    const facePath=arc(start,end,rx,rx);
    const face=el('path',{d:facePath,fill:base,stroke:darkenColor(base,.68),'stroke-width':'2.2',class:'visual-charts-face'},moving);
    const step=(cfg.depth/2).toFixed(2);
    face.style.filter=cfg.depth>0
      ? 'drop-shadow(0 '+step+'px 0 '+darkenColor(base,.82)+') drop-shadow(0 '+step+'px 0 '+darkenColor(base,.67)+') drop-shadow(0 4px 3px rgba(0,0,0,.15))'
      : 'drop-shadow(0 3px 3px rgba(0,0,0,.15))';
    // Bridge only the exposed outer corners of the stacked shadow.
    // This does not change the face, the existing shadow or slice ordering.
    if(cfg.depth>0){
      for(const angle of [start,end]){
        if(Math.sin(angle)<=.01)continue;
        const [px,py]=point(angle,rx,ry);
        el('path',{
          d:'M '+px+' '+(py+1)+' L '+px+' '+(py+cfg.depth),
          fill:'none',stroke:darkenColor(base,.67),
          'stroke-width':'2.2','stroke-linecap':'round',
          class:'visual-charts-corner-bridge'
        },moving);
      }
    }
    const [tx,ty]=point(mid,rx*.67,ry*.67);
    const txt=el('text',{x:tx,y:ty+4,'text-anchor':'middle',class:'visual-charts-percent'},moving);
    txt.textContent=(data.value/total*100).toFixed(0)+'%';
    group.addEventListener('mouseenter',event=>showTip(data,base,data.value/total*100,event));
    group.addEventListener('mousemove',moveTip);
    group.addEventListener('mouseleave',hideTip);
    group.addEventListener('focus',()=>showTip(data,base,data.value/total*100));
    group.addEventListener('blur',hideTip);
    sliceGroups.push({group,frontness:Math.sin(mid)});
  });
  // SVG paints later children on top. Paint rear slices first and lower slices last.
  sliceGroups.sort((a,b)=>a.frontness-b.frontness);
  const restoreOrder=()=>sliceGroups.forEach(item=>svg.appendChild(item.group));
  restoreOrder();
  sliceGroups.forEach(({group})=>{
    group.addEventListener('mouseenter',()=>svg.appendChild(group));
    group.addEventListener('mouseleave',restoreOrder);
    group.addEventListener('focus',()=>svg.appendChild(group));
    group.addEventListener('blur',restoreOrder);
  });
  const legend=host.createDiv({cls:'visual-charts-legend'});
  cfg.data.forEach((d,i)=>{
    const item=legend.createSpan({cls:'visual-charts-legend-item'});
    const dot=item.createSpan({cls:'visual-charts-dot'});
    dot.style.background=colors[i%colors.length];
    item.createSpan({text:d.label+' · '+d.value});
  });
}
module.exports=class VisualCharts extends Plugin {
  onload(){
    this.registerMarkdownCodeBlockProcessor('visual-chart',(source,el)=>{
      try{render(source,el);}
      catch(error){el.empty();el.createEl('pre',{text:'Visual Charts: '+error.message,cls:'visual-charts-error'});}
    });
  }
};
