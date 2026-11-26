(() => {
  const project = 'sxduheddnlskphdarsiw';
  const url = 'https://' + project + '.supabase.co/rest/v1/rpc/wedding_';
  const key = "sb_publishable_Dg4FfLchJj3kGP9AJDbSdA_E58kDDoG";

  async function request(method, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(),12000);
    try {
      const response = await fetch(url + method,{
        method:'POST', headers:{apikey:key,'Content-Type':'application/json'},
        body:JSON.stringify(body), signal:controller.signal, credentials:'omit',
        cache:'no-store', referrerPolicy:'no-referrer'
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || 'wedding_unavailable');
      return payload;
    } finally {
      clearTimeout(timer);
    }
  }

  function readToken(hash) {
    const params = new URLSearchParams(hash.slice(1));
    if (!params.has('s')) return params.get('share');

    const compact = params.get('s');
    if (!/^[A-Za-z0-9_-]{43}$/.test(compact)) return '';
    try {
      const bytes = atob(compact.replace(/-/g,'+').replace(/_/g,'/') + '=');
      const canonical = btoa(bytes).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
      if (bytes.length !== 32 || canonical !== compact) return '';
      return Array.from(bytes,byte => byte.charCodeAt(0).toString(16).padStart(2,'0')).join('');
    } catch {
      return '';
    }
  }

  window.WeddingCloud = {
    project,
    readToken,
    load(token) { return request('load',{p_share:token}); },
    save(token,revision,state) {
      return request('save',{p_share:token,p_revision:revision,p_data:state});
    }
  };
})();
