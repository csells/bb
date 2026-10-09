import {createNodeBbSdk} from '/Users/admin/code/Forks/get-bb/bb/packages/sdk/dist/node.js';
import {readFile,rm} from 'node:fs/promises';
const root='/Users/admin/rooms-participation-spike';
const sdk=createNodeBbSdk({baseUrl:'http://127.0.0.1:38886'});
for(const file of ['live-evidence.json','live2-evidence.json','live3-evidence.json']){
 const e=JSON.parse(await readFile(root+'/'+file,'utf8'));
 for(const threadId of Object.values(e.threads)){
  const t=await sdk.threads.get({threadId});
  if(!['idle','stopped','error'].includes(t.status))throw Error('Refuse cleanup active thread '+threadId);
  await sdk.threads.archive({threadId});console.log('archived '+threadId);
 }
}
for(const dir of ['live','live2','live3','protocol','protocol2'])await rm(root+'/'+dir,{recursive:true,force:true});
console.log('Removed scratch activation credentials, bearer hashes, broker SQLite, and argument fixtures. Sources and sanitized evidence retained.');
