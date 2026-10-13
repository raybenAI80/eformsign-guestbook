# Stream-reshard a single safetensors file into ~200MB shards without mmap (low commit memory)
import json, struct, sys, os, shutil, numpy as np, torch
from safetensors.torch import save_file
src_dir, dst_dir = sys.argv[1], sys.argv[2]
os.makedirs(dst_dir, exist_ok=True)
for n in os.listdir(src_dir):
    p=os.path.join(src_dir,n)
    if n!="model.safetensors":
        (shutil.copytree if os.path.isdir(p) else shutil.copy)(p, os.path.join(dst_dir,n))
DT={"BF16":torch.bfloat16,"F32":torch.float32,"F16":torch.float16,"I64":torch.int64,"I32":torch.int32,"BOOL":torch.bool}
f=open(os.path.join(src_dir,"model.safetensors"),"rb"); hl=struct.unpack("<Q",f.read(8))[0]; hdr=json.loads(f.read(hl)); base=8+hl
meta=hdr.pop("__metadata__",None)
shard={}; size=0; idx=0; wmap={}
def flush():
    global shard,size,idx
    if not shard: return
    name=f"model-{idx:05d}.safetensors"; save_file(shard, os.path.join(dst_dir,name), metadata={"format":"pt"})
    for k in shard: wmap[k]=name
    shard={}; size=0; idx+=1
for k,v in sorted(hdr.items(), key=lambda kv: kv[1]["data_offsets"][0]):
    a,b=v["data_offsets"]; f.seek(base+a); buf=bytearray(f.read(b-a))
    t=torch.frombuffer(buf,dtype=DT[v["dtype"]]).reshape(v["shape"]).clone() if b>a else torch.empty(v["shape"],dtype=DT[v["dtype"]])
    shard[k]=t; size+=b-a
    if size>2e8: flush()
flush()
json.dump({"metadata":{},"weight_map":wmap}, open(os.path.join(dst_dir,"model.safetensors.index.json"),"w"))
print("shards", idx)
