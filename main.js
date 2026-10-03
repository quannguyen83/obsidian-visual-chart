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

function renderVenn(source,host){
  host.empty();host.addClass('visual-charts','visual-charts-venn');
  const cfg={
    title:'Requirements are about the real world.',style:'flat',depth:'8',
    environment:'Environment|real world',system:'System',
    phenomena:'Phenomena of|the real world',shared:'Shared|phenomena',
    sensors:'Sensors and|actuators',
    requirement:'The reverse thrust shall be enabled if and only if the aircraft is on ground.',
    knowledge:'If the aircraft is on ground, wheel rotation impulses exceed x per sec.',
    specification:'The reverse thrust shall be enabled if and only if wheel rotation impulses exceed x per sec.'
  };
  for(const raw of source.split(/\r?\n/)){
    const line=raw.trim();if(!line||line.startsWith('#'))continue;
    const match=line.match(/^([a-zA-Z]+)\s*:\s*(.*)$/);
    if(match&&Object.prototype.hasOwnProperty.call(cfg,match[1])){
      cfg[match[1]]=match[2].replace(/^['"]|['"]$/g,'');
    }
  }
  const raised=cfg.style==='raised';
  const depth=raised?Math.max(0,Math.min(14,Number(cfg.depth)||8)):0;
  const svg=el('svg',{viewBox:'0 0 980 650',role:'img','aria-label':cfg.title,
    class:'visual-charts-venn-svg'},host);
  const defs=el('defs',{},svg),marker=el('marker',{id:'venn-arrow-'+Math.random().toString(36).slice(2),
    viewBox:'0 0 10 10',refX:9,refY:5,markerWidth:7,markerHeight:7,orient:'auto-start-reverse'},defs);
  el('path',{d:'M 0 0 L 10 5 L 0 10 z',fill:'currentColor'},marker);
  const arrow='url(#'+marker.getAttribute('id')+')';
  const text=(x,y,str,size=19,weight=500,color='currentColor',anchor='start',parent=svg)=>{
    const t=el('text',{x,y,fill:color,'font-size':size,'font-weight':weight,
      'text-anchor':anchor,class:'visual-charts-venn-text'},parent);
    String(str).split('|').forEach((line,i)=>{const s=el('tspan',{x,dy:i?'1.18em':0},t);s.textContent=line;});
    return t;
  };
  const line=(x1,y1,x2,y2)=>el('line',{x1,y1,x2,y2,stroke:'currentColor','stroke-width':1.65,
    'marker-end':arrow,class:'visual-charts-venn-arrow'},svg);
  const slab=(parent,x,y,w,h,rx,fill,d=depth)=>{
    const g=el('g',{class:'visual-charts-venn-slab'},parent);
    if(d>0){
      el('rect',{x,y:y+d,width:w,height:h,rx,fill:darkenColor(fill,.67)},g);
      el('rect',{x,y:y+d*.52,width:w,height:h,rx,fill:darkenColor(fill,.82)},g);
    }
    el('rect',{x,y,width:w,height:h,rx,fill,stroke:darkenColor(fill,.65),'stroke-width':1.5},g);
    return g;
  };
  const card=(x,y,w,h,label,color)=>{
    const g=slab(svg,x,y,w,h,8,color,raised?5:0);
    text(x+13,y+25,label,18,650,'#272727','start',g);
  };
  // Split the intersecting ellipses into three *independent* closed surfaces.
  // Their boundary arcs meet at the same two intersection points: no transparency
  // overlay, no double-thickness at the intersection.
  const A={cx:329,cy:268,rx:249,ry:124},B={cx:656,cy:268,rx:235,ry:107};
  const upper=(e,x)=>e.ry*Math.sqrt(Math.max(0,1-((x-e.cx)/e.rx)**2));
  let lo=Math.max(A.cx-A.rx,B.cx-B.rx),hi=Math.min(A.cx+A.rx,B.cx+B.rx);
  for(let i=0;i<65;i++){
    const mid=(lo+hi)/2;
    if(upper(A,mid)>upper(B,mid))lo=mid;else hi=mid;
  }
  const cross=(lo+hi)/2;
  const ta=Math.acos((cross-A.cx)/A.rx),tb=Math.acos((cross-B.cx)/B.rx);
  const boundary=(ellipse,from,to)=>{
    const count=Math.ceil(Math.abs(to-from)/.025);
    const points=[];
    for(let i=0;i<=count;i++){
      const angle=from+(to-from)*i/count;
      points.push([(ellipse.cx+ellipse.rx*Math.cos(angle)).toFixed(3),
                   (ellipse.cy+ellipse.ry*Math.sin(angle)).toFixed(3)]);
    }
    return points;
  };
  const polygon=(parts)=>'M '+parts.flat().map(pt=>pt.join(' ')).join(' L ')+' Z';
  const regions=[
    {name:'environment',color:'#bcbcbc',
      d:polygon([boundary(A,-ta,ta-2*Math.PI),boundary(B,tb,2*Math.PI-tb)])},
    {name:'system',color:'#8789eb',
      d:polygon([boundary(B,-tb,tb),boundary(A,ta,-ta)])},
    {name:'intersection',color:'#a2a3d4',
      d:polygon([boundary(A,-ta,ta),boundary(B,tb,2*Math.PI-tb)])}
  ];
  const regionLayer=el('g',{class:'visual-charts-venn-regions'},svg);
  // Keep ALL depth silhouettes below ALL top faces, regardless of selection.
  // Moving an entire piece to the end previously placed its dark side wall over
  // a neighbouring top surface (especially visible at the intersection).
  const depthLayer=el('g',{class:'visual-charts-venn-depth-layer'},regionLayer);
  // A single continuous silhouette avoids seams where neighbouring bottoms meet.
  if(raised&&depth>0){
    const shell=regions.map(r=>r.d).join(' ');
    const gradId=marker.getAttribute('id')+'-shell';
    const gradient=el('linearGradient',{id:gradId,x1:'0%',y1:'0%',x2:'100%',y2:'0%'},defs);
    for(const [offset,color] of [['0%',darkenColor('#bcbcbc',.70)],
      ['49%',darkenColor('#a2a3d4',.70)],['100%',darkenColor('#8789eb',.70)]]){
      el('stop',{offset,'stop-color':color},gradient);
    }
    const steps=Math.ceil(depth*2);
    for(let i=steps;i>=0;i--){
      el('path',{d:shell,transform:'translate(0 '+(depth*i/steps).toFixed(3)+')',
        fill:'url(#'+gradId+')',class:'visual-charts-venn-shell'},depthLayer);
    }
  }
  const faceLayer=el('g',{class:'visual-charts-venn-face-layer'},regionLayer);
  const regionGroups=[];
  let selectedRegion=null;
  for(const region of regions){
    const shadow=el('g',{class:'visual-charts-venn-shadow-piece'},depthLayer);
    const face=el('g',{class:'visual-charts-venn-piece',tabindex:'0',
      role:'button','aria-label':region.name+' region','aria-pressed':'false'},faceLayer);
    const lift=Math.max(6,depth+2)+'px';
    shadow.style.setProperty('--venn-lift',lift);
    face.style.setProperty('--venn-lift',lift);
    shadow.style.display='none'; // The unselected chart uses the shared shell.
    if(raised&&depth>0){
      const steps=Math.ceil(depth*2);
      for(let i=steps;i>=0;i--){
        el('path',{d:region.d,
          transform:'translate(0 '+(depth*i/steps).toFixed(3)+')',
          fill:darkenColor(region.color,.70),class:'visual-charts-venn-piece-depth'},shadow);
      }
    }
    el('path',{d:region.d,fill:region.color,stroke:darkenColor(region.color,.70),
      'stroke-width':1.35,'stroke-linejoin':'round',
      class:'visual-charts-venn-region visual-charts-venn-'+region.name},face);
    const piece={face,shadow};
    regionGroups.push(piece);
    const toggle=()=>{
      const next=selectedRegion===piece?null:piece;
      if(selectedRegion){
        for(const node of [selectedRegion.face,selectedRegion.shadow])node.classList.remove('is-selected');
        selectedRegion.face.setAttribute('aria-pressed','false');
        selectedRegion.shadow.style.display='none';
      }
      selectedRegion=next;
      if(next){
        for(const node of [next.face,next.shadow])node.classList.add('is-selected');
        next.face.setAttribute('aria-pressed','true');
        next.shadow.style.display='none';
        depthLayer.appendChild(next.shadow);
        faceLayer.appendChild(next.face);
      }else {
        regionGroups.forEach(item=>depthLayer.appendChild(item.shadow));
        regionGroups.forEach(item=>faceLayer.appendChild(item.face));
      }
    };
    face.addEventListener('click',toggle);
    face.addEventListener('keydown',event=>{
      if(event.key==='Enter'||event.key===' '){event.preventDefault();toggle();}
    });
  }
  text(490,32,cfg.title,29,750,'currentColor','middle');
  text(288,258,cfg.environment,31,630,'#252525','middle');
  text(697,277,cfg.system,31,630,'#202038','middle');
  card(38,66,220,64,cfg.phenomena,'#ffe7da');
  card(383,59,185,65,cfg.shared,'#ffe7da');
  card(716,66,219,65,cfg.sensors,'#fff4d1');
  line(256,120,262,187);
  line(476,124,499,250);
  line(726,127,539,246);
  // Examples are wrapped as foreignObject-free SVG paragraphs for portability.
  const example=(x,y,w,heading,body)=>{
    const g=el('g',{class:'visual-charts-venn-example'},svg);
    if(raised){
      el('rect',{x,y:y+6,width:w,height:155,rx:12,fill:'var(--background-modifier-border)'},g);
      el('rect',{x,y:y+3,width:w,height:155,rx:12,fill:'var(--background-secondary-alt)'},g);
    }
    el('rect',{x,y,width:w,height:155,rx:12,fill:'var(--background-secondary)',
      stroke:'var(--background-modifier-border)'},g);
    text(x+14,y+27,heading,19,750,'#df8951','start',g);
    const words=body.split(/\s+/);let lines=[],current='';
    for(const word of words){
      if((current+' '+word).trim().length>31){lines.push(current);current=word;}
      else current=(current+' '+word).trim();
    }if(current)lines.push(current);
    text(x+14,y+57,lines.slice(0,4).join('|'),16,450,'currentColor','start',g);
  };
  line(185,416,294,360);
  line(482,416,412,365);
  line(795,416,696,354);
  example(20,425,293,'Requirements',cfg.requirement);
  example(344,425,293,'World Knowledge',cfg.knowledge);
  example(668,425,293,'Specification',cfg.specification);
  text(490,624,'World / Machine · Requirements Engineering',13,450,
    'var(--text-muted)','middle');
}

module.exports=class VisualCharts extends Plugin {
  onload(){
    this.registerMarkdownCodeBlockProcessor('visual-chart',(source,el)=>{
      try{
        const kind=source.match(/^\s*type\s*:\s*([^\r\n#]+)/m);
        const type=kind?kind[1].trim().replace(/^['\"]|['\"]$/g,''):'pie-3d';
        if(type==='venn')renderVenn(source,el);
        else render(source,el);
      }
      catch(error){el.empty();el.createEl('pre',{text:'Visual Charts: '+error.message,cls:'visual-charts-error'});}
    });
  }
};
