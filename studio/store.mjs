import {mkdir,readFile,writeFile,rename,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
export function createStore(root) {
 const path=id=>{if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Invalid project ID');return `${root}/${id}.json`};
 return {
  async read(id){return JSON.parse(await readFile(path(id),'utf8'))},
  async save(project){await mkdir(root,{recursive:true});const file=path(project.id),temp=file+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(project),{mode:0o600});await rename(temp,file);return project},
  async list(){await mkdir(root,{recursive:true});const files=(await readdir(root)).filter(f=>f.endsWith('.json'));const results=[];for(const file of files){const p=JSON.parse(await readFile(`${root}/${file}`,'utf8'));results.push({id:p.id,url:p.url,platform:p.platform,name:p.name,status:p.status,revision:p.revisions.length,updatedAt:p.updatedAt})}return results.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))}
 };
}
