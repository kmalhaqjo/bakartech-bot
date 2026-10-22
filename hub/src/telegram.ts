import { Env, TIERS, tierFor, nextTier, fa } from './env';

type TgUpdate = any;
const API = (e: Env, method: string) => `https://api.telegram.org/bot${e.BOT_TOKEN}/${method}`;

export async function tg(e: Env, method: string, body: any) {
  const r = await fetch(API(e, method), {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body)});
  const j:any = await r.json();
  if (!j.ok) throw new Error(`${method}: ${JSON.stringify(j)}`);
  return j.result;
}
const admins=(e:Env)=>new Set(e.ADMIN_IDS.split(',').map(x=>x.trim()).filter(Boolean));
const isAdmin=(e:Env,id:number)=>admins(e).has(String(id));
const kb=(rows:any[][])=>({inline_keyboard:rows});

const mainMenu = kb([
  [{text:'🎓 دوره جامع',callback_data:'course'},{text:'🦅 اوطاق شکار VIP',callback_data:'vip'}],
  [{text:'💳 پرداخت و ثبت‌نام',callback_data:'buy'},{text:'👤 حساب من',callback_data:'profile'}],
  [{text:'🎯 دعوت دوستان و رتبه',callback_data:'ref'}],
  [{text:'📚 آموزش رایگان',callback_data:'free'},{text:'❓ سوالات متداول',callback_data:'faq'}],
  [{text:'🛟 پشتیبانی',url:'https://t.me/BakarSupport'}]
]);

async function ensureUser(e:Env, from:any):Promise<boolean>{
 const existed=await e.DB.prepare(`SELECT 1 FROM users WHERE telegram_id=?`).bind(from.id).first();
 await e.DB.prepare(`INSERT INTO users(telegram_id,username,first_name) VALUES(?,?,?) ON CONFLICT(telegram_id) DO UPDATE SET username=excluded.username,first_name=excluded.first_name,updated_at=CURRENT_TIMESTAMP`).bind(from.id,from.username||'',from.first_name||'').run();
 return !existed;
}
async function send(e:Env,chatId:number,text:string,markup?:any){return tg(e,'sendMessage',{chat_id:chatId,text,parse_mode:'HTML',reply_markup:markup,disable_web_page_preview:true});}
async function edit(e:Env,chatId:number,msgId:number,text:string,markup?:any){return tg(e,'editMessageText',{chat_id:chatId,message_id:msgId,text,parse_mode:'HTML',reply_markup:markup,disable_web_page_preview:true});}

function homeText(name='دوست') {return `سلام <b>${name} جان</b>! 🙋‍♂️\nبه <b>🦅 Bakartech Academy</b> خوش آمدی.\n\nاز منوی زیر انتخاب کن:`}

async function showPackages(e:Env,chat:number,msg?:number){
 const {results}=await e.DB.prepare(`SELECT * FROM packages WHERE is_active=1 ORDER BY CASE id WHEN 'course' THEN 0 ELSE 1 END,id`).all<any>();
 const rows=results.map((p:any)=>[{text:`${p.title}`,callback_data:`pkg:${p.id}`}]); rows.push([{text:'⬅️ برگشت',callback_data:'home'}]);
 const text=`<b>پکیج‌های Bakartech Academy</b>\n\nبرای دیدن قیمت و جزئیات، یک پکیج را انتخاب کن:`;
 return msg?edit(e,chat,msg,text,kb(rows)):send(e,chat,text,kb(rows));
}
async function packageView(e:Env,chat:number,msg:number,id:string){
 const p:any=await e.DB.prepare(`SELECT * FROM packages WHERE id=?`).bind(id).first(); if(!p)return;
 let details=id==='course'?`✅ آموزش صفر تا پیشرفته\n✅ فارکس، طلا و US30\n✅ پرایس‌اکشن، مدیریت سرمایه و روانشناسی\n✅ منتورشیپ و بررسی معاملات\n✅ اوطاق شکار و لایو نیویورک\n✅ پشتیبانی`: `✅ لایو سشن نیویورک\n✅ بررسی معاملات و مدیریت ریسک\n✅ محیط آموزشی اوطاق شکار\n⚠️ سیگنال‌فروشی نیست؛ آموزش و ترید لایو است.`;
 let price=id==='course'?`🌍 خارج افغانستان و ایران: <b>$650</b>\n🇦🇫 افغانستان و 🇮🇷 ایران: <b>$200</b>\n🔥 تخفیف منطقه‌ای: <b>$450 (حدود 69٪)</b>`:`💵 قیمت: <b>$${p.price_international}</b>`;
 await edit(e,chat,msg,`<b>${p.title}</b>\n\n${details}\n\n${price}`,kb([[{text:'✅ ثبت‌نام و پرداخت',callback_data:`buy:${id}`}],[{text:'⬅️ پکیج‌ها',callback_data:'buy'}]]));
}
async function chooseCountry(e:Env,chat:number,msg:number,pkg:string){
 await edit(e,chat,msg,`کشور محل پرداخت را انتخاب کن:`,kb([[{text:'🇦🇫 افغانستان',callback_data:`country:${pkg}:regional`},{text:'🇮🇷 ایران',callback_data:`country:${pkg}:regional`}],[{text:'🌍 سایر کشورها',callback_data:`country:${pkg}:international`}],[{text:'⬅️ برگشت',callback_data:`pkg:${pkg}`}]]));
}
async function chooseMethod(e:Env,chat:number,msg:number,pkg:string,group:string,userId:number){
 await e.DB.prepare(`UPDATE users SET country_group=?,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=?`).bind(group,userId).run();
 const {results}=await e.DB.prepare(`SELECT * FROM payment_methods WHERE is_active=1 AND (country_group='all' OR country_group=?) ORDER BY sort_order,id`).bind(group).all<any>();
 const rows=results.map((m:any)=>[{text:m.title,callback_data:`method:${pkg}:${m.id}`}]);rows.push([{text:'⬅️ برگشت',callback_data:`buy:${pkg}`}]);
 await edit(e,chat,msg,`روش پرداخت را انتخاب کن:`,kb(rows));
}
async function methodView(e:Env,chat:number,msg:number,pkg:string,mid:number,userId:number){
 const m:any=await e.DB.prepare(`SELECT * FROM payment_methods WHERE id=?`).bind(mid).first();
 const p:any=await e.DB.prepare(`SELECT * FROM packages WHERE id=?`).bind(pkg).first();
 const u:any=await e.DB.prepare(`SELECT country_group FROM users WHERE telegram_id=?`).bind(userId).first();
 const amount=u?.country_group==='regional'?p.price_regional:p.price_international;
 await e.DB.prepare(`UPDATE users SET state='awaiting_receipt',state_data=?,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=?`).bind(JSON.stringify({pkg,mid,amount}),userId).run();
 await edit(e,chat,msg,`<b>${m.title}</b>\n\n${m.details}\n\nمبلغ قابل پرداخت: <b>$${amount}</b>\n\nبعد از پرداخت، <b>اسکرین‌شات رسید یا TXID</b> را همین‌جا ارسال کن.`,kb([[{text:'❌ لغو پرداخت',callback_data:'cancel'}]]));
}

async function receipt(e:Env,msg:any,state:any){
 const d=JSON.parse(state.state_data||'{}'); const file=msg.photo?.at(-1)?.file_id||msg.document?.file_id||null; const txid=msg.text||msg.caption||null;
 if(!file&&!txid){await send(e,msg.chat.id,'لطفاً عکس رسید، فایل رسید یا TXID را ارسال کن.');return;}
 const r=await e.DB.prepare(`INSERT INTO payments(telegram_id,package_id,method_id,amount,receipt_file_id,txid) VALUES(?,?,?,?,?,?) RETURNING id`).bind(msg.from.id,d.pkg,d.mid,d.amount,file,txid).first<any>();
 await e.DB.prepare(`UPDATE users SET state=NULL,state_data=NULL WHERE telegram_id=?`).bind(msg.from.id).run();
 await send(e,msg.chat.id,`✅ رسیدت با شماره <b>#${r.id}</b> ثبت شد.\nبعد از بررسی ادمین، نتیجه همین‌جا ارسال می‌شود.`,mainMenu);
 const caption=`🔔 <b>پرداخت جدید #${r.id}</b>\n👤 ${msg.from.first_name||''} @${msg.from.username||'-'}\n🆔 <code>${msg.from.id}</code>\n📦 ${d.pkg}\n💵 $${d.amount}\n${txid?`📝 ${txid}`:''}`;
 for(const a of admins(e)){
  const markup=kb([[{text:'✅ تأیید',callback_data:`approve:${r.id}`},{text:'❌ رد',callback_data:`reject:${r.id}`}]]);
  if(file&&msg.photo) await tg(e,'sendPhoto',{chat_id:a,photo:file,caption,parse_mode:'HTML',reply_markup:markup});
  else if(file) await tg(e,'sendDocument',{chat_id:a,document:file,caption,parse_mode:'HTML',reply_markup:markup});
  else await send(e,Number(a),caption,markup);
 }
}
async function reviewPayment(e:Env,adminChat:number,msgId:number,pid:number,approve:boolean){
 const p:any=await e.DB.prepare(`SELECT p.*,k.title,k.duration_days,k.grants_vip FROM payments p JOIN packages k ON k.id=p.package_id WHERE p.id=?`).bind(pid).first();
 if(!p||p.status!=='pending'){await tg(e,'answerCallbackQuery',{callback_query_id:'',text:'قبلاً بررسی شده'}).catch(()=>{});return;}
 if(!approve){await e.DB.prepare(`UPDATE payments SET status='rejected',reviewed_at=CURRENT_TIMESTAMP WHERE id=?`).bind(pid).run(); await send(e,p.telegram_id,`❌ پرداخت شماره <b>#${pid}</b> تأیید نشد.\nبرای بررسی بیشتر با پشتیبانی تماس بگیر: ${e.SUPPORT_URL}`); return;}
 let invite='';
 if(p.grants_vip){
  const expire=Math.floor(Date.now()/1000)+(p.duration_days>0?p.duration_days:7)*86400;
  const link:any=await tg(e,'createChatInviteLink',{chat_id:e.VIP_CHANNEL_ID,name:`payment-${pid}`,expire_date:expire,member_limit:1}); invite=link.invite_link;
 }
 const expires=p.duration_days>0?new Date(Date.now()+p.duration_days*86400000).toISOString():null;
 await e.DB.batch([
  e.DB.prepare(`UPDATE payments SET status='approved',reviewed_at=CURRENT_TIMESTAMP WHERE id=?`).bind(pid),
  e.DB.prepare(`INSERT INTO memberships(telegram_id,package_id,expires_at,invite_link) VALUES(?,?,?,?)`).bind(p.telegram_id,p.package_id,expires,invite)
 ]);
 await send(e,p.telegram_id,`✅ <b>پرداختت تأیید شد!</b>\n📦 ${p.title}\n${invite?`\n🔗 لینک اختصاصی ورود:\n${invite}\n\n⚠️ لینک یک‌بارمصرف است و آن را برای کسی نفرست.`:''}`);
}

async function adminPanel(e:Env,chat:number,msg?:number){
 const text='<b>⚙️ پنل مدیریت Bakartech</b>\nهمه مدیریت از داخل تلگرام انجام می‌شود.';
 const m=kb([[{text:'💳 پرداخت‌های در انتظار',callback_data:'adm:payments'}],[{text:'🏦 روش‌های پرداخت',callback_data:'adm:methods'}],[{text:'📊 آمار',callback_data:'adm:stats'}],[{text:'📢 پیام همگانی',callback_data:'adm:broadcast'}],[{text:'⬅️ منوی اصلی',callback_data:'home'}]]);
 return msg?edit(e,chat,msg,text,m):send(e,chat,text,m);
}
export async function handleCallback(e:Env,q:any){
 const d=q.data,chat=q.message.chat.id,msg=q.message.message_id,uid=q.from.id; await tg(e,'answerCallbackQuery',{callback_query_id:q.id});
 if(d==='home')return edit(e,chat,msg,homeText(q.from.first_name),mainMenu);
 if(d==='course')return packageView(e,chat,msg,'course'); if(d==='vip'||d==='buy')return showPackages(e,chat,msg);
 if(d.startsWith('pkg:'))return packageView(e,chat,msg,d.split(':')[1]);
 if(d.startsWith('buy:'))return chooseCountry(e,chat,msg,d.split(':')[1]);
 if(d.startsWith('country:')){const[,p,g]=d.split(':');return chooseMethod(e,chat,msg,p,g,uid);}
 if(d.startsWith('method:')){const[,p,m]=d.split(':');return methodView(e,chat,msg,p,Number(m),uid);}
 if(d==='cancel'){await e.DB.prepare(`UPDATE users SET state=NULL,state_data=NULL WHERE telegram_id=?`).bind(uid).run();return edit(e,chat,msg,'پرداخت لغو شد.',mainMenu);}
 if(d==='profile'){
  const {results}=await e.DB.prepare(`SELECT m.*,p.title FROM memberships m JOIN packages p ON p.id=m.package_id WHERE telegram_id=? ORDER BY m.id DESC`).bind(uid).all<any>();
  const t=results.length?results.map((x:any)=>`• ${x.title} — ${x.status}${x.expires_at?` تا ${x.expires_at.slice(0,10)}`:''}`).join('\n'):'هنوز عضویت فعالی نداری.';return edit(e,chat,msg,`<b>👤 حساب من</b>\n\n${t}`,kb([[{text:'⬅️ برگشت',callback_data:'home'}]]));
 }
 if(d==='ref')return refView(e,chat,msg,uid);
 if(d==='free')return edit(e,chat,msg,`<b>📚 آموزش رایگان</b>\nمطالب رایگان و لینک‌های آموزشی از این بخش منتشر می‌شود.\n\nکانال و شبکه‌های رسمی:\n${e.SKOOL_URL}`,kb([[{text:'⬅️ برگشت',callback_data:'home'}]]));
 if(d==='faq')return edit(e,chat,msg,`<b>❓ سوالات متداول</b>\n\n• اوطاق شکار کانال سیگنال نیست؛ معاملات و آموزش لایو است.\n• پرداخت‌ها فقط پس از بررسی ادمین فعال می‌شوند.\n• برای مشکل پرداخت با پشتیبانی تماس بگیر.`,kb([[{text:'🛟 پشتیبانی',url:e.SUPPORT_URL}],[{text:'⬅️ برگشت',callback_data:'home'}]]));
 if(d.startsWith('approve:')&&isAdmin(e,uid)){await reviewPayment(e,chat,msg,Number(d.split(':')[1]),true);return edit(e,chat,msg,`${q.message.caption||q.message.text||''}\n\n✅ تأیید شد.`).catch(()=>{});}
 if(d.startsWith('reject:')&&isAdmin(e,uid)){await reviewPayment(e,chat,msg,Number(d.split(':')[1]),false);return edit(e,chat,msg,`${q.message.caption||q.message.text||''}\n\n❌ رد شد.`).catch(()=>{});}
 if(d==='adm:stats'&&isAdmin(e,uid)){const u:any=await e.DB.prepare(`SELECT COUNT(*) c FROM users`).first();const p:any=await e.DB.prepare(`SELECT COUNT(*) c FROM payments WHERE status='pending'`).first();return edit(e,chat,msg,`<b>📊 آمار</b>\n👥 کاربران: ${u.c}\n⏳ پرداخت در انتظار: ${p.c}`,kb([[{text:'⬅️ برگشت',callback_data:'admin'}]]));}
 if(d==='admin'&&isAdmin(e,uid))return adminPanel(e,chat,msg);
}

export async function handleMessage(e:Env,m:any){
 const isNew=await ensureUser(e,m.from); const text=m.text||'';
 if(text==='/start'||text.startsWith('/start ')){
  const payload=text.split(' ')[1]||'';
  if(isNew&&payload.startsWith('ref_'))await registerReferral(e,m.from,Number(payload.slice(4)));
  return send(e,m.chat.id,homeText(m.from.first_name),mainMenu);
 }
 if(text==='/invite'||text==='/ref')return refView(e,m.chat.id,undefined,m.from.id);
 if(text==='/admin'&&isAdmin(e,m.from.id))return adminPanel(e,m.chat.id);
 const st:any=await e.DB.prepare(`SELECT state,state_data FROM users WHERE telegram_id=?`).bind(m.from.id).first();
 if(st?.state==='awaiting_receipt')return receipt(e,m,st);
 return send(e,m.chat.id,'از منوی زیر انتخاب کن 👇',mainMenu);
}


// ---------------- referrals (اوطاق شکار)
async function refCount(e:Env,uid:number){const r:any=await e.DB.prepare(`SELECT COUNT(*) c FROM users WHERE referred_by=?`).bind(uid).first();return r?.c||0;}
async function registerReferral(e:Env,from:any,refId:number){
 if(!refId||refId===from.id)return;
 const ref:any=await e.DB.prepare(`SELECT telegram_id FROM users WHERE telegram_id=?`).bind(refId).first(); if(!ref)return;
 await e.DB.prepare(`UPDATE users SET referred_by=? WHERE telegram_id=? AND referred_by IS NULL`).bind(refId,from.id).run();
 const n=await refCount(e,refId); const t=tierFor(n); const justReached=TIERS.find(x=>x.min===n);
 let msg=`🎉 <b>${from.first_name||'یک دوست'}</b> با لینک دعوت تو وارد اوطاق شکار شد!\n📊 دعوت‌های تو: <b>${fa(n)}</b>`;
 if(justReached)msg+=`\n\n🏆 تبریک! به رتبهٔ <b>${justReached.name}</b> رسیدی 🔥`;
 else{const nt=nextTier(n); if(nt)msg+=`\n🎯 تا رتبهٔ ${nt.name} فقط <b>${fa(nt.min-n)}</b> دعوت دیگر`;}
 await send(e,refId,msg).catch(()=>{});
}
async function refView(e:Env,chat:number,msg:number|undefined,uid:number){
 const n=await refCount(e,uid); const t=tierFor(n), nt=nextTier(n);
 const link=`https://t.me/${e.BOT_USERNAME}?start=ref_${uid}`;
 const ladder=TIERS.map(x=>`${x.name} ← ${fa(x.min)} دعوت`).join('\n');
 const text=`<b>🎯 دعوت دوستان | اوطاق شکار</b>\n\n🔗 لینک اختصاصی تو:\n<code>${link}</code>\n\n📊 دعوت‌های تو: <b>${fa(n)}</b>\n🏷️ رتبه: <b>${t?t.name:'هنوز رتبه‌ای نداری'}</b>\n${nt?`🎯 تا ${nt.name}: <b>${fa(nt.min-n)}</b> دعوت دیگر`:'👑 بالاترین رتبه!'}\n\n<b>مسیر رتبه‌ها:</b>\n${ladder}\n\nلینک را برای دوستان تریدرت بفرست 👥`;
 const m=kb([[{text:'📤 اشتراک‌گذاری لینک',url:`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent('به اوطاق شکار Bakartech بپیوند 🦅')}`}],[{text:'⬅️ برگشت',callback_data:'home'}]]);
 return msg?edit(e,chat,msg,text,m):send(e,chat,text,m);
}
