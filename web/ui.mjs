export const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const longDate=new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric'});
export const dateLabel=value=>longDate.format(new Date(value+'T12:00:00')).replace(/\s*г\.$/u,'');
export const timeLabel=seconds=>'0:'+String(Math.floor(seconds || 0)).padStart(2,'0');
