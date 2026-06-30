export function dominoFooterJS(rowId) {
  return `(function(){
  var rowEl=document.getElementById('${rowId}');
  if(!rowEl)return;
  var GAP=7,BAR=3,ROW_H=22,STEP=40,TRAIL=15,T_FALL=120,T_RISE=100,PAUSE=800;
  var FULL_W=rowEl.offsetWidth||960;
  var NCOLS=Math.max(1,Math.floor((FULL_W+GAP)/(BAR+GAP)));
  var rowDiv=document.createElement('div');
  rowDiv.style.cssText='display:flex;gap:'+GAP+'px;align-items:flex-end;height:'+ROW_H+'px;overflow:visible';
  var bars=[];
  for(var i=0;i<NCOLS;i++){var b=document.createElement('div');b.className='d-bar';b.style.height=ROW_H+'px';rowDiv.appendChild(b);bars.push(b);}
  rowEl.appendChild(rowDiv);rowEl.style.overflow='visible';
  var TOTAL=NCOLS+TRAIL,p=0;
  function tick(){
    var ci=NCOLS-1-p;
    if(p<NCOLS){bars[ci].style.transition='transform '+T_FALL+'ms ease-in';bars[ci].style.transform='rotateZ(-70deg)';}
    var rp=p-TRAIL,rc=NCOLS-1-rp;
    if(rp>=0&&rp<NCOLS){bars[rc].style.transition='transform '+T_RISE+'ms ease-out';bars[rc].style.transform='';}
    p++;
    if(p>=TOTAL){p=0;setTimeout(tick,PAUSE);}else{setTimeout(tick,STEP);}
  }
  tick();
}())`;
}
