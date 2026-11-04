import fs from 'node:fs';
import {createHash} from 'node:crypto';
const root=new URL('../../foundation/core/',import.meta.url);
const manifest=JSON.parse(fs.readFileSync(new URL('manifest.json',root),'utf8'));
export function reviveData(_key,value){if(value?.$type==='RegExp'){if(typeof value.source!=='string'||value.source.length>500||typeof value.flags!=='string'||!/^[imu]*$/.test(value.flags))throw new Error('Invalid trusted foundation pattern');return new RegExp(value.source,value.flags);}return value;}
export function encodeData(value){return JSON.stringify(value,(_key,v)=>{if(v instanceof RegExp)return {$type:'RegExp',source:v.source,flags:v.flags};if(typeof v==='function')throw new Error('Foundation data cannot contain executable functions');return v;},2)+'\n';}
export function loadCore(name){const meta=manifest.files[name];if(!meta)throw new Error('Unknown core foundation asset');const bytes=fs.readFileSync(new URL(name,root));if(createHash('sha256').update(bytes).digest('hex')!==meta.sha256)throw new Error('Core foundation integrity failed: '+name);return JSON.parse(bytes,reviveData);}
export function coreStatus(){return {version:manifest.version,files:manifest.files,licenses:manifest.licenses};}
