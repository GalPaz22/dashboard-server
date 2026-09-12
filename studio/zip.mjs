// Small uncompressed ZIP writer for generated UTF-8 text files; bounded input.
function crc32(buffer){let crc=0xffffffff;for(const byte of buffer){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}return (crc^0xffffffff)>>>0}
export function zipFiles(files){
 const chunks=[],entries=[];let offset=0;
 for(const [name,text] of Object.entries(files)){
  if(!/^[a-zA-Z0-9_.-]+$/.test(name))throw Error('Invalid archive name');
  const filename=Buffer.from(name),data=Buffer.from(text);if(data.length>200000)throw Error('Artifact too large');
  const crc=crc32(data),header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt32LE(crc,14);header.writeUInt32LE(data.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(filename.length,26);
  chunks.push(header,filename,data);
  const entry=Buffer.alloc(46);entry.writeUInt32LE(0x02014b50);entry.writeUInt16LE(20,4);entry.writeUInt16LE(20,6);entry.writeUInt16LE(0x800,8);entry.writeUInt32LE(crc,16);entry.writeUInt32LE(data.length,20);entry.writeUInt32LE(data.length,24);entry.writeUInt16LE(filename.length,28);entry.writeUInt32LE(offset,42);entries.push(entry,filename);offset+=header.length+filename.length+data.length;
 }
 const central=Buffer.concat(entries),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);const count=Object.keys(files).length;end.writeUInt16LE(count,8);end.writeUInt16LE(count,10);end.writeUInt32LE(central.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...chunks,central,end]);
}
