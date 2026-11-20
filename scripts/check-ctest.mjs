// Require the complete enabled suite before CTest may report a subject PASS.
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const REQUIRED_SUITES=Object.freeze({
  platform:Object.freeze(['fgm_cpu','core-c05-parity','core-external-consumer',
    'raster-rvi-oracle','raster-c05-parity',
    'r12-cli','r01-free-corpus','r02-map-mcd-facts','r03-loft-voxels','r04-sprite-facts',
    'r05-projection','r06-reconstruction','r06-entity-evidence','r06-whole-object',
    'r06-whole-build-native','r07-panel-fit','r07-local-source-baseline',
    'r07-surface-observability','r07-local-constrained-fit','r07-whole-source-preflight',
    'r07-whole-surface-observability','r07-whole-joint-synthetic-fit','r07-fitted-surface','r07-whole-boundary-audit','rv01-reconstruction-viewer',
    'regenerator-studio-protocol','regenerator-studio-cell','regenerator-studio-catalog',
    'regenerator-studio-whole','renderer-camera','renderer-map-camera','renderer-scene']),
  core:Object.freeze(['core-c05-parity','core-external-consumer','fgm_cpu']),
  consumer:Object.freeze(['consumer-public-api']),
});
const fail=code=>{throw new Error(code);};
const enabled=value=>value===true||value===1||typeof value==='string'&&/^(1|true|on|yes)$/i.test(value);

export function assertCTestSuite(report,suite='core'){
  const expected=REQUIRED_SUITES[suite];
  if(!expected)fail('CTEST_UNKNOWN_SUITE:'+suite);
  if(report?.kind!=='ctestInfo'||report.version?.major!==1||!Array.isArray(report.tests))fail('CTEST_INVENTORY_FORMAT');
  const names=report.tests.map(t=>t?.name);
  if(names.some(n=>typeof n!=='string')||names.length!==expected.length
    ||new Set(names).size!==names.length||names.some(n=>!expected.includes(n)))
    fail('CTEST_SUITE_MISMATCH:'+suite+':'+JSON.stringify(names));
  for(const test of report.tests){
    if(!Array.isArray(test.command)||!test.command.length||test.command.some(v=>typeof v!=='string'||!v))
      fail('CTEST_EMPTY_COMMAND:'+test.name);
    if(test.properties!==undefined&&!Array.isArray(test.properties))fail('CTEST_INVENTORY_FORMAT');
    for(const p of test.properties||[]){
      if(p.name==='DISABLED'&&enabled(p.value))fail('CTEST_DISABLED:'+test.name);
      if(p.name==='WILL_FAIL'&&enabled(p.value))fail('CTEST_EXPECTED_FAILURE:'+test.name);
      if(['SKIP_RETURN_CODE','SKIP_REGULAR_EXPRESSION'].includes(p.name))fail('CTEST_SKIP_POLICY:'+test.name);
    }
  }
  return [...names].sort();
}

export function checkCTestSuite(ctest,buildDir,suite='core',config='Release'){
  const raw=execFileSync(ctest,['--test-dir',resolve(buildDir),'-C',config,'--show-only=json-v1'],
    {encoding:'utf8',maxBuffer:8*1024*1024,stdio:['ignore','pipe','pipe']});
  let report;try{report=JSON.parse(raw);}catch{fail('CTEST_INVENTORY_JSON');}
  const names=assertCTestSuite(report,suite);
  const result={result:'PASS',suite,registered:names.length,required:names};
  console.log(JSON.stringify(result));return result;
}

export function runCTestSuite(ctest,buildDir,suite='core',config='Release'){
  checkCTestSuite(ctest,buildDir,suite,config);
  execFileSync(ctest,['--test-dir',resolve(buildDir),'-C',config,'--output-on-failure','--no-tests=error'],{stdio:'inherit'});
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const [buildDir,...args]=process.argv.slice(2);
    if(!buildDir)fail('CTEST_BUILD_DIR_REQUIRED');
    const options={ctest:'ctest',suite:'core',config:'Release'};
    for(let i=0;i<args.length;i+=2){
      const key=args[i].slice(2);
      if(!args[i].startsWith('--')||!Object.hasOwn(options,key)||!args[i+1])fail('CTEST_ARGUMENT');
      options[key]=args[i+1];
    }
    checkCTestSuite(options.ctest,buildDir,options.suite,options.config);
  }catch(error){console.error('CTEST_GATE_FAILED: '+error.message);process.exitCode=1;}
}
