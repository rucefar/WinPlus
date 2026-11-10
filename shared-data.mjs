// Three-way merges keep unrelated edits from different accounts.
export const copy = value => structuredClone(value);
export const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const sharedPart = data => copy({cells:data.cells || {}, fields:data.fields || {}, mindmap:data.mindmap || [], ninety90:data.ninety90 || []});
const object = value => value && typeof value === 'object' && !Array.isArray(value);

// Add private selections without replacing work already edited by the team.
export function addSelectedData(current, selected) {
  const next=sharedPart(current);
  for(const key of ['cells','fields'])for(const [id,value] of Object.entries(selected[key])){
    if(next[key][id] == null || next[key][id] === '')next[key][id]=copy(value);
  }
  for(const key of ['ninety90','mindmap']){
    const existing=new Set(next[key].map(row=>row.id));
    for(const row of selected[key])if(!existing.has(row.id)){next[key].push(copy(row));existing.add(row.id);}
  }
  return validateShared(next);
}

export function selectSharedData(source, {customerIds=[],includeGrid=false,includeOrganization=false}={}) {
  const selected=new Set(customerIds);
  return validateShared({
    cells:includeGrid ? copy(source.cells || {}) : {},
    fields:includeGrid ? copy(source.fields || {}) : {},
    ninety90:copy((source.ninety90 || []).filter(row=>selected.has(row.id))),
    mindmap:includeOrganization ? copy(source.mindmap || []).map(row=>{
      if(row.linkedCrmId && !selected.has(row.linkedCrmId))delete row.linkedCrmId;
      return row;
    }) : []
  });
}

export function merge(base, local, remote, path = '') {
  if (equal(local, base)) return copy(remote);
  if (equal(remote, base) || equal(local, remote)) return copy(local);
  if (object(base) && object(local) && object(remote)) {
    const result = {};
    for (const key of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
      const value = merge(base[key], local[key], remote[key], `${path}/${key}`);
      if (value !== undefined) Object.defineProperty(result,key,{value,enumerable:true,writable:true,configurable:true});
    }
    return result;
  }
  if (['/mindmap', '/ninety90'].includes(path) && [base,local,remote].every(Array.isArray)) {
    const maps = [base,local,remote].map(rows => Object.fromEntries(rows.map(row => [row.id,row])));
    const rows = merge(...maps, `${path}/records`);
    const order = [...new Set([...remote.map(r=>r.id), ...local.map(r=>r.id)])];
    return order.filter(id=>rows[id] !== undefined).map(id=>rows[id]);
  }
  const error = new Error(`另一位夥伴也修改了相同欄位：${path}`);
  error.code = 'sync-conflict';
  throw error;
}

export function validateShared(data) {
  for (const key of ['mindmap', 'ninety90']) {
    if (!Array.isArray(data[key])) throw new Error('共用資料格式錯誤');
    const ids = data[key].map(row=>row.id);
    if (new Set(ids).size !== ids.length) throw new Error('資料含重複識別碼，請先整理後再共用');
  }
  for (const row of data.ninety90) {
    if (!Number.isSafeInteger(row.id) || row.id < 1 || typeof row.name !== 'string') throw new Error('名單識別碼或姓名格式錯誤');
  }
  const nodes = new Map(data.mindmap.map(row=>[row.id,row]));
  for (const row of nodes.values()) {
    if (typeof row.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(row.id) || typeof row.text !== 'string') throw new Error('組織節點格式錯誤');
    const seen = new Set([row.id]);
    let parent = row.parentId;
    while (parent) {
      if (seen.has(parent) || !nodes.has(parent)) throw new Error('組織結構已被另一位夥伴變更，請重新載入後調整');
      seen.add(parent); parent = nodes.get(parent).parentId;
    }
  }
  return data;
}
