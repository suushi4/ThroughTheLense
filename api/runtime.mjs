export default function handler(request, response) {
  response.setHeader('Cache-Control','no-store');
  if (request.method !== 'GET') {
    response.setHeader('Allow','GET');
    response.status(405).json({message:'Метод недоступен.'});
    return;
  }
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const config = url && key?.startsWith('sb_publishable_') ? {mode:'supabase',url,key} : {mode:'guest'};
  if (process.env.VERCEL_ENV === 'production' && process.env.TTL_VERCEL_ANALYTICS === '1') {
    config.analytics = 'vercel';
  }
  response.status(200).json(config);
}
