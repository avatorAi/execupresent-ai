
export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);

    // 1) 申し込み受信
    if (url.pathname === "/api/order" && req.method === "POST") {
      const form = await req.formData();
      const email   = form.get("contact_email");
      const company = form.get("company_name");
      const plan    = form.get("selected_plan");
      const jobId   = crypto.randomUUID();

      // MakeLeaps: 取引先登録
      const auth    = "Basic " + btoa(`${env.ML_KEY}:${env.ML_SECRET}`);
      const contact = await fetch("https://app.makeleaps.com/api/v1/contacts", {
        method: "POST",
        headers: { Authorization: auth, "Content-Type": "application/json" },
        body: JSON.stringify({ name: company, email }),
      }).then(r => r.json());

      // MakeLeaps: 請求書作成
      const priceMap = { light:300000, standard:420000, premium:540000 };
      const invoice  = await fetch("https://app.makeleaps.com/api/v1/invoices", {
        method: "POST",
        headers: { Authorization: auth, "Content-Type": "application/json" },
        body: JSON.stringify({
          contact_id: contact.id,
          title: `ExecuPresent AI - ${plan}`,
          subtotal: priceMap[plan] || priceMap.light,
          due_on: new Date(Date.now()+14*864e5).toISOString().slice(0,10),
          metadata: { job_id: jobId },
        }),
      }).then(r => r.json());

      // MakeLeaps: PDF請求書メール送信
      await fetch(`https://app.makeleaps.com/api/v1/invoices/${invoice.id}/send`, {
        method: "POST",
        headers: { Authorization: auth },
      });

      // D1 にジョブ登録 (processing)
      await env.DB.prepare(
        "INSERT INTO jobs (id,email,plan,status) VALUES (?1,?2,?3,'processing')"
      ).bind(jobId, email, plan).run();

      return new Response(JSON.stringify({ ok:true }), { headers: { "content-type":"application/json" } });
    }

    // 2) D‑ID 完了 Webhook
    if (url.pathname === "/api/did/webhook" && req.method === "POST") {
      const body = await req.json();
      if (body.status === "done") {
        const bin = await fetch(body.result_url).then(r => r.arrayBuffer());
        await env.VIDEO_BUCKET.put(`${body.metadata.job_id}.mp4`, bin, { httpMetadata:{ contentType:"video/mp4" } });
        await env.DB.prepare(
          "UPDATE jobs SET status='done' WHERE id=?1"
        ).bind(body.metadata.job_id).run();
      }
      return new Response("ok");
    }

    return new Response("Not found", { status: 404 });
  }
};
