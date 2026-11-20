import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {assertCTestSuite,checkCTestSuite,REQUIRED_SUITES} from '../scripts/check-ctest.mjs';

const cmake=process.env.FGMP_CMAKE||'cmake',ctest=process.env.FGMP_CTEST||'ctest';
const names=['core-c05-parity','core-external-consumer','fgm_cpu'];
const report=(ns=names)=>({kind:'ctestInfo',version:{major:1,minor:0},
  tests:ns.map(name=>({name,command:['synthetic-command'],properties:[]}))});

test('Platform requires all 32 tests and rejects omissions and disabled subjects',()=>{
  const all=REQUIRED_SUITES.platform;
  assert.equal(all.length,32);
  assert.equal(assertCTestSuite(report(all),'platform').length,32);
  for(const name of all){
    assert.throws(()=>assertCTestSuite(report(all.filter(n=>n!==name)),'platform'),/CTEST_SUITE_MISMATCH/);
    const r=report(all);r.tests.find(t=>t.name===name).properties=[{name:'DISABLED',value:true}];
    assert.throws(()=>assertCTestSuite(r,'platform'),/CTEST_DISABLED/);
  }
  assert.throws(()=>assertCTestSuite(report(names),'platform'),/CTEST_SUITE_MISMATCH/);
});

test('exact enabled core and consumer inventories',()=>{
  assert.deepEqual(assertCTestSuite(report()),names);
  assert.deepEqual(assertCTestSuite(report(['consumer-public-api']),'consumer'),['consumer-public-api']);
});
for(const [name,ns]of [['empty',[]],['missing',names.slice(1)],['extra',[...names,'unexpected']],
  ['duplicate',[names[0],names[0],names[2]]],['substituted',[names[0],names[1],'dummy']]])
  test('reject '+name+' inventory',()=>assert.throws(()=>assertCTestSuite(report(ns)),/CTEST_SUITE_MISMATCH/));
test('reject disabled test',()=>{
  const r=report();r.tests[0].properties=[{name:'DISABLED',value:true}];
  assert.throws(()=>assertCTestSuite(r),/CTEST_DISABLED/);
});
test('reject empty command',()=>{
  const r=report();r.tests[0].command=[];assert.throws(()=>assertCTestSuite(r),/CTEST_EMPTY_COMMAND/);
});
test('reject expected-failure inversion and skip policies',()=>{
  for(const property of [{name:'WILL_FAIL',value:true},{name:'SKIP_RETURN_CODE',value:0},
    {name:'SKIP_REGULAR_EXPRESSION',value:'.*'}]){
    const r=report();r.tests[0].properties=[property];
    assert.throws(()=>assertCTestSuite(r),/CTEST_EXPECTED_FAILURE|CTEST_SKIP_POLICY/);
  }
});
test('reject malformed inventory and unknown suite',()=>{
  assert.throws(()=>assertCTestSuite({tests:[]}),/CTEST_INVENTORY_FORMAT/);
  assert.throws(()=>assertCTestSuite(report(),'unrestricted'),/CTEST_UNKNOWN_SUITE/);
});
test('real CMake: zero tests and disabled BUILD_TESTING cannot pass the gate',()=>{
  const temp=mkdtempSync(join(tmpdir(),'fgmp-ctest-empty-'));
  try{
    writeFileSync(join(temp,'CMakeLists.txt'),
      'cmake_minimum_required(VERSION 3.24)\nproject(empty LANGUAGES NONE)\ninclude(CTest)\n');
    for(const testing of ['ON','OFF']){
      const build=join(temp,'build-'+testing);
      execFileSync(cmake,['-S',temp,'-B',build,'-DBUILD_TESTING='+testing],{stdio:'pipe'});
      execFileSync(cmake,['--build',build,'--config','Release'],{stdio:'pipe'});
      const args=['--test-dir',build,'-C','Release','--output-on-failure'];
      const env={...process.env};delete env.CTEST_NO_TESTS_ACTION;
      const old=spawnSync(ctest,args,{encoding:'utf8',env});
      assert.equal(old.status,0);assert.match(old.stdout+old.stderr,/No tests were found/);
      const strict=spawnSync(ctest,[...args,'--no-tests=error'],{encoding:'utf8',env});
      assert.notEqual(strict.status,0);
      assert.throws(()=>checkCTestSuite(ctest,build,'core'),/CTEST_SUITE_MISMATCH/);
      assert.throws(()=>checkCTestSuite(ctest,build,'consumer'),/CTEST_SUITE_MISMATCH/);
      console.log(JSON.stringify({case:'zero-tests',BUILD_TESTING:testing,old_exit:old.status,
        strict_exit:strict.status,core_inventory:'REJECTED',consumer_inventory:'REJECTED'}));
    }
  }finally{rmSync(temp,{recursive:true,force:true});}
});
test('real CMake: two passing tests cannot substitute for three required tests',()=>{
  const temp=mkdtempSync(join(tmpdir(),'fgmp-ctest-partial-'));
  try{
    writeFileSync(join(temp,'CMakeLists.txt'),
      'cmake_minimum_required(VERSION 3.24)\nproject(partial LANGUAGES NONE)\ninclude(CTest)\n'+
      'add_test(NAME fgm_cpu COMMAND "${CMAKE_COMMAND}" -E true)\n'+
      'add_test(NAME core-c05-parity COMMAND "${CMAKE_COMMAND}" -E true)\n');
    const build=join(temp,'build');
    execFileSync(cmake,['-S',temp,'-B',build,'-DBUILD_TESTING=ON'],{stdio:'pipe'});
    const passed=spawnSync(ctest,['--test-dir',build,'-C','Release','--no-tests=error'],{encoding:'utf8'});
    assert.equal(passed.status,0);
    assert.throws(()=>checkCTestSuite(ctest,build,'core'),/CTEST_SUITE_MISMATCH/);
    console.log(JSON.stringify({case:'two-tests',strict_exit:passed.status,required_three_inventory:'REJECTED'}));
  }finally{rmSync(temp,{recursive:true,force:true});}
});
