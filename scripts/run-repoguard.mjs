// A file-backed stdout preserves the complete JSON when the pinned CLI exits immediately.
import {spawnSync} from 'node:child_process';
import {mkdtempSync,openSync,closeSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

export function runRepoGuard(cli,repository,directory,base,head) {
  const temp=mkdtempSync(join(tmpdir(),'fgmp-compiler-report-'));
  const path=join(temp,'report.json');
  let fd;
  try {
    fd=openSync(path,'w');
    const p=spawnSync(process.execPath,[cli,'--repo-root',directory,'check','--base',base,'--head',head,'--format','json'],
      {encoding:'utf8',maxBuffer:32*1024*1024,stdio:['ignore',fd,'pipe'],
        env:{...process.env,GITHUB_REPOSITORY:repository}});
    closeSync(fd);fd=undefined;
    if(p.error)throw p.error;
    let report;
    try {report=JSON.parse(readFileSync(path,'utf8'));}
    catch {throw new Error('Invalid compiler JSON: '+String(p.stderr).slice(0,1200));}
    if(report.format!=='repo-guard/local-compiler-v1'||typeof report.ok!=='boolean'
      ||report.base!==base||report.head!==head||p.status!==(report.ok?0:1))
      throw new Error('Inconsistent compiler exit or exact refs');
    return {status:p.status,report};
  } finally {if(fd!==undefined)closeSync(fd);rmSync(temp,{recursive:true,force:true});}
}
