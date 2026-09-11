/**
 * ccs-building-camera.js — Three.js r128
 */
/* globals THREE, ccsRenderer */
var ccsCamera, ccsControls;
var CCS_HOME_POS    = new THREE.Vector3(0, 12, 62);
var CCS_HOME_TARGET = new THREE.Vector3(0,  6,  0);

var _tr=false,_ts=0,_td=1200;
var _fp=new THREE.Vector3(),_tp=new THREE.Vector3();
var _ft=new THREE.Vector3(),_tt=new THREE.Vector3();

function ccsCameraInit() {
  var w = ccsRenderer.domElement.clientWidth || 800;
  var h = ccsRenderer.domElement.clientHeight || 600;
  ccsCamera = new THREE.PerspectiveCamera(48, w/h, 0.5, 600);
  ccsCamera.position.copy(CCS_HOME_POS);
  ccsCamera.lookAt(CCS_HOME_TARGET);

  var OC = typeof THREE.OrbitControls !== 'undefined' ? THREE.OrbitControls
         : (typeof OrbitControls !== 'undefined' ? OrbitControls : null);
  if (!OC) { console.error('[CCS] OrbitControls missing'); return; }

  ccsControls = new OC(ccsCamera, ccsRenderer.domElement);
  ccsControls.enableDamping  = true;
  ccsControls.dampingFactor  = 0.07;
  ccsControls.minDistance    = 10;
  ccsControls.maxDistance    = 180;
  ccsControls.minPolarAngle  = 0.05;
  ccsControls.maxPolarAngle  = Math.PI / 2 - 0.02;
  ccsControls.target.copy(CCS_HOME_TARGET);
  ccsControls.update();
}

function ccsCameraMoveTo(toPos, toTgt, dur) {
  _fp.copy(ccsCamera.position); _tp.copy(toPos);
  _ft.copy(ccsControls.target); _tt.copy(toTgt);
  _td=dur||1200; _ts=performance.now(); _tr=true;
}
function ccsCameraHome() { ccsCameraMoveTo(CCS_HOME_POS, CCS_HOME_TARGET, 1200); }
function ccsCameraUpdateTransition() {
  if (!_tr) return false;
  var p=Math.min((performance.now()-_ts)/_td,1);
  var t=p<0.5?4*p*p*p:1-Math.pow(-2*p+2,3)/2;
  ccsCamera.position.lerpVectors(_fp,_tp,t);
  ccsControls.target.lerpVectors(_ft,_tt,t);
  ccsControls.update();
  if(p>=1){_tr=false;ccsCamera.position.copy(_tp);ccsControls.target.copy(_tt);ccsControls.update();}
  return _tr;
}
