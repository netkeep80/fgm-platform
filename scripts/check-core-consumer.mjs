// Build a distinct CMake project with Core's tests disabled and the consumer's CTest enabled.
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,extname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runCTestSuite} from './check-ctest.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const cmake=process.argv[2];
if(!cmake)throw new Error('CMake executable required');
const temp=mkdtempSync(join(tmpdir(),'fgmp-core-consumer-'));
try {
  execFileSync(cmake,['-S',join(root,'tests/core/consumer'),'-B',temp,
    '-DFGMP_SOURCE_DIR='+root,'-DCMAKE_BUILD_TYPE=Release','-DBUILD_TESTING=ON'],{stdio:'inherit'});
  execFileSync(cmake,['--build',temp,'--config','Release','--parallel','2'],{stdio:'inherit'});
  runCTestSuite(join(dirname(cmake),'ctest'+extname(cmake)),temp,'consumer');
  console.log(JSON.stringify({result:'PASS',consumer:'add_subdirectory(core)',
    target:'fgm::cpu',core_tests:false,consumer_testing:true}));
} finally {rmSync(temp,{recursive:true,force:true});}
