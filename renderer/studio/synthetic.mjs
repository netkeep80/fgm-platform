// Public domain-free synthetic test corpus owned by this project; never UFO bytes.
export function syntheticFixture() {
  const map=new Uint8Array([1,1,1,0,1,2,2]);
  const blanks=new Uint8Array(2*62);
  blanks[42]=blanks[62+42]=1;
  const terrain=new Uint8Array(62);
  terrain[42]=1;
  terrain.fill(1,8,20);
  terrain[8]=0;
  const loft=new Uint8Array(64);
  for(let y=3;y<6;y++){loft[y*2]=0;loft[y*2+1]=0x38}
  // Two pixels at (0,0)/(17,0) and one over the LOFT silhouette at (16,22).
  const pck=new Uint8Array([0,42,254,16,42,254,255,254,255,254,192,91,255]);
  const tab=new Uint8Array(2);
  const palette=new Uint8Array(768);
  palette.set([63,40,18],42*3);
  palette.set([44,56,63],91*3);
  return Object.entries({map,blanks,terrain,loft,pck,tab,palette})
    .map(([name,bytes])=>new File([bytes],name,{type:"application/octet-stream"}));
}
