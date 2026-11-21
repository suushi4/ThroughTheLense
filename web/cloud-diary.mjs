const partition = 4 * 1024 * 1024;
const maxParts = 19;

export function cloudDiary(client, owner) {
  const table = () => client.from('diary_days');
  const storage = client.storage.from('diary-copies');
  const query = id => table().select('*').eq('owner',owner).eq('id',id).maybeSingle();
  function unwrap({data,error}) {
    if (error) throw error;
    return data;
  }
  const paths = (revision, count) => Array.from({length:count}, (_, index) => owner+'/'+revision+'/'+index+'.json');

  return {
    async list() {
      const rows = unwrap(await table().select('id,summary').eq('owner',owner));
      return rows.map(({summary,id}) => ({...summary,id}));
    },
    async open(id) {
      const row = unwrap(await query(id));
      if (!row) return undefined;
      const parts = await Promise.all(paths(row.revision,row.parts).map(async path => unwrap(await storage.download(path))));
      return new Blob(parts, {type:'application/json'});
    },
    async save(id, summary, copy, editing) {
      const old = unwrap(await query(id));
      if (editing && !old) throw Error('День уже удалён.');
      if (!editing && old) return;
      const revision = crypto.randomUUID();
      const parts = Math.ceil(copy.size/partition);
      if (parts > maxParts) throw Error('Копия дня слишком большая.');
      const keys = paths(revision, parts);
      try {
        // Wait until every upload has settled before trying to remove a partial revision.
        const uploads = await Promise.allSettled(keys.map(async (path,index) => unwrap(await storage.upload(
          path,copy.slice(index*partition,(index+1)*partition,'application/json'),{contentType:'application/json'}
        ))));
        if (uploads.some(result => result.status === 'rejected')) throw Error('Не удалось загрузить материалы дня.');
        if (editing) {
          const changed = unwrap(await table().update({summary,revision,parts})
            .eq('owner',owner).eq('id',id).eq('revision',old.revision).select('id'));
          if (!changed.length) throw Error('Запись изменилась в другой вкладке. Откройте её заново.');
        } else {
          unwrap(await table().insert({owner,id,summary,revision,parts}));
        }
      } catch (error) {
        await storage.remove(keys).catch(() => {});
        throw error;
      }
      if (old) await storage.remove(paths(old.revision,old.parts)).catch(() => {});
    },
    async remove(id) {
      const rows = unwrap(await table().delete().eq('owner',owner).eq('id',id).select('revision,parts'));
      if (rows.length) await storage.remove(paths(rows[0].revision,rows[0].parts)).catch(() => {});
    }
  };
}
