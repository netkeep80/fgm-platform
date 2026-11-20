// Independent TEST-ONLY world-space ray / voxel-box oracle. No FGM or LOFT interpreter.
export function reference(voxels,camera,width=420,height=315,depth="nearest"){
  const {yaw,pitch,distance}=camera;
  const c=Math.cos(yaw),s=Math.sin(yaw),sp=Math.sin(pitch),cp=Math.cos(pitch);
  const basis=[[c,-s,0],[s*sp,c*sp,-cp],[s*cp,c*cp,sp]];
  const dot=(a,b)=>a.reduce((v,x,i)=>v+x*b[i],0);
  const projected=[];
  for(const v of voxels)for(let bits=0;bits<8;bits++){
    const p=v.map((n,i)=>n+((bits>>i)&1));projected.push(basis.map(b=>dot(p,b)));
  }
  const lower=[0,1,2].map(i=>Math.min(...projected.map(p=>p[i])));
  const upper=[0,1,2].map(i=>Math.max(...projected.map(p=>p[i])));
  const scale=.8*Math.min(width/(upper[0]-lower[0]+2),height/(upper[1]-lower[1]+2))/distance;
  const point=(px,py)=>{
    const coords=[(px+.5-width/2)/scale+(lower[0]+upper[0])/2,
      (py+.5-height/2)/scale+(lower[1]+upper[1])/2,upper[2]+10];
    const origin=[0,1,2].map(i=>coords.reduce((v,q,j)=>v+q*basis[j][i],0));
    const dir=basis[2].map(x=>-x);
    let nearest=null,edge=false;
    for(const voxel of voxels){
      let enter=-Infinity,exit=Infinity,enterFace=-1,exitFace=-1,nearEnter=-Infinity,nearExit=Infinity;
      for(let axis=0;axis<3;axis++){
        const a=(voxel[axis]-origin[axis])/dir[axis],b=(voxel[axis]+1-origin[axis])/dir[axis];
        const lo=Math.min(a,b),hi=Math.max(a,b);
        if(lo>enter){enter=lo;enterFace=axis}if(hi<exit){exit=hi;exitFace=axis}
        const expanded=[(voxel[axis]-.025-origin[axis])/dir[axis],(voxel[axis]+1+.025-origin[axis])/dir[axis]];
        nearEnter=Math.max(nearEnter,Math.min(...expanded));nearExit=Math.min(nearExit,Math.max(...expanded));
      }
      if(exit<enter||exit<0){
        // Outside silhouette samples can also graze a box. Bound both sides of an edge,
        // rather than exempting arbitrary pixel errors or increasing RGB tolerance.
        if(nearExit>=nearEnter&&nearExit>=0)edge=true;
        continue;
      }
      const t=depth==="nearest"?enter:exit,face=depth==="nearest"?enterFace:exitFace;
      const hit=origin.map((n,i)=>n+t*dir[i]);
      const margin=Math.min(...hit.filter((_,i)=>i!==face).map((n,j)=>{
        const axis=[0,1,2].filter(i=>i!==face)[j];return Math.min(n-voxel[axis],voxel[axis]+1-n);
      }));
      if(margin<.025)edge=true;
      if(nearest&&(depth==="nearest"?t>=nearest.t:t<=nearest.t))continue;
      const center=voxel.map(x=>x+.5);center[face]=voxel[face]+((dir[face]<0)===(depth==="nearest")?1:0);
      nearest={t,color:dot(center,basis[2])>0?[102,140,156]:[81,116,133]};
    }
    return {color:nearest?.color??[16,27,43],edge};
  };
  return {point};
}
export function compare(pixels,voxels,camera,width=420,height=315,depth="nearest"){
  const oracle=reference(voxels,camera,width,height,depth);
  let checked=0,bad=0,foreground=0,background=0,boundary_skipped=0;const mismatches=[],boundaryDifferences=[];
  for(let y=2;y<height;y+=3)for(let x=2;x<width;x+=3){
    const expected=oracle.point(x,y),start=(y*width+x)*4;
    if(expected.edge){
      boundary_skipped++;
      if((pixels[start+3]!==255||expected.color.some((v,i)=>Math.abs(v-pixels[start+i])>1))&&boundaryDifferences.length<8)
        boundaryDifferences.push({x,y,expected:expected.color,actual:Array.from(pixels.slice(start,start+4))});
      continue;
    }
    checked++;
    if(expected.color[0]===16)background++;else foreground++;
    if(pixels[start+3]!==255||expected.color.some((v,i)=>Math.abs(v-pixels[start+i])>1)){
      bad++;if(mismatches.length<8)mismatches.push({x,y,expected:expected.color,actual:Array.from(pixels.slice(start,start+4))});
    }
  }
  return {checked,bad,foreground,background,boundary_skipped,boundaryDifferences,...(bad?{mismatches}: {})};
}
