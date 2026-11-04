// API do site do casamento — Cloudflare Pages Functions + D1
// Variáveis no painel da Cloudflare:
//   DB    -> ligação (binding) com o banco D1
//   SENHA -> segredo (secret) com a senha da Área dos noivos

const COLS = { config: 1, itens: 1, gifts: 1, convites: 1, rsvp: 1, historico: 1, espera: 1 };
const CFG_PUBLICO = ["casal", "data", "hora", "local", "endereco", "chave", "nome", "cidade", "acrescimo", "linkCartao", "rsvpPrazo", "entrega", "site"];
const MAX_BODY = 600000;
const TOKEN_HORAS = 24 * 7;

// ---------- utilidades ----------
function json(dados, status = 200, extra = {}) {
  return new Response(JSON.stringify(dados), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });
}
const erro = (msg, status = 400) => json({ erro: msg }, status);
const agora = () => new Date().toISOString();

function idAleatorio(n = 12) {
  const ch = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const a = new Uint32Array(n);
  crypto.getRandomValues(a);
  let s = "";
  for (let i = 0; i < n; i++) s += ch[a[i] % ch.length];
  return s;
}
function norm(t) {
  return String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/\(.*?\)/g, " ").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}
const texto = (v, max) => String(v == null ? "" : v).trim().slice(0, max);

async function lerCorpo(request) {
  const tam = Number(request.headers.get("content-length") || 0);
  if (tam > MAX_BODY) throw new Error("grande");
  const t = await request.text();
  if (t.length > MAX_BODY) throw new Error("grande");
  return t ? JSON.parse(t) : {};
}

// ---------- banco ----------
async function listar(db, col) {
  const r = await db.prepare("SELECT id, data FROM docs WHERE col = ?").bind(col).all();
  return (r.results || []).map((x) => Object.assign({ id: x.id }, JSON.parse(x.data)));
}
async function pegar(db, col, id) {
  const r = await db.prepare("SELECT data FROM docs WHERE col = ? AND id = ?").bind(col, id).first();
  return r ? Object.assign({ id }, JSON.parse(r.data)) : null;
}
async function gravar(db, col, id, dados) {
  const d = Object.assign({}, dados);
  delete d.id;
  await db.prepare(
    "INSERT INTO docs (col, id, data, atualizado) VALUES (?, ?, ?, ?) ON CONFLICT(col, id) DO UPDATE SET data = excluded.data, atualizado = excluded.atualizado"
  ).bind(col, id, JSON.stringify(d), agora()).run();
  return Object.assign({ id }, d);
}
async function apagar(db, col, id) {
  await db.prepare("DELETE FROM docs WHERE col = ? AND id = ?").bind(col, id).run();
}
async function config(db) {
  return (await pegar(db, "config", "site")) || {};
}

// ---------- autenticação ----------
async function hmac(segredo, msg) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(segredo), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg));
  return [...new Uint8Array(s)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function iguais(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
// A senha pode vir do segredo SENHA (painel) ou do banco (coleção privada "segredo").
async function senhaAtual(env, db) {
  if (env.SENHA && String(env.SENHA).trim()) return String(env.SENHA).trim();
  const s = await pegar(db, "segredo", "senha");
  return s && s.senha ? String(s.senha).trim() : "";
}
async function criarToken(senha) {
  const exp = String(Date.now() + TOKEN_HORAS * 3600 * 1000);
  return exp + "." + (await hmac(senha + "|noivos", exp));
}
async function tokenValido(senha, request) {
  const h = request.headers.get("authorization") || "";
  const t = h.replace(/^Bearer\s+/i, "");
  const [exp, sig] = t.split(".");
  if (!exp || !sig || !senha) return false;
  if (Number(exp) < Date.now()) return false;
  return iguais(sig, await hmac(senha + "|noivos", exp));
}

// ---------- regras de presentes ----------
function usoDosItens(gifts) {
  const uso = {};
  for (const g of gifts) {
    if (!g.itemId) continue;
    const u = (uso[g.itemId] = uso[g.itemId] || { conf: 0, pend: 0 });
    if (g.status === "confirmado") u.conf += g.qtd || 1;
    else if (g.status === "pendente" || g.status === "reservado") u.pend += g.qtd || 1;
  }
  return uso;
}
function prazoEncerrado(cfg) {
  if (!cfg.rsvpPrazo) return false;
  // fim do dia do prazo no horário de Brasília (UTC-3)
  return Date.now() > new Date(cfg.rsvpPrazo + "T23:59:59-03:00").getTime();
}
async function conviteDoCodigo(db, codigo) {
  codigo = texto(codigo, 40);
  if (!codigo) return null;
  const todos = await listar(db, "convites");
  return todos.find((c) => c.codigo === codigo) || todos.find((c) => !c.codigo && c.id === codigo) || null;
}

// ---------- fotos ----------
async function guardarFoto(db, dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || "");
  if (!m) return null;
  if (m[2].length > 400000) return null;
  const id = idAleatorio(16);
  await db.prepare("INSERT INTO fotos (id, mime, data) VALUES (?, ?, ?)").bind(id, m[1], m[2]).run();
  return "/api/foto/" + id;
}
function base64ParaBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}


// ---------- preparo automático do banco ----------
// Cria as tabelas se ainda não existirem e, se o banco estiver vazio, carrega os dados iniciais.
const DADOS_INICIAIS = [["config", "site", {"casal": "Lívia e Henrique", "data": "2027-05-15", "hora": "17:30", "local": "Igreja Matriz de Sant'Ana", "endereco": "Praça 9 de Julho, 5, Areias - SP", "capacidade": 180, "acrescimo": 0, "chave": "", "nome": "", "cidade": "", "linkCartao": ""}], ["convites", "familia-fabao-nu9a", {"codigo": "h94k4wkxvz", "enviado": false, "enviadoEm": "", "nome": "Família Fabão", "pessoas": ["Fábio", "Karen", "Ana Clara", "Maria", "Beatriz", "Gustavo"], "telefone": "", "eventos": ["casamento"]}], ["convites", "familia-matheus-63bt", {"codigo": "UNAUM4fqVX", "enviado": false, "enviadoEm": "", "eventos": ["casamento"], "lado": "noivo", "nome": "Família Matheus", "pessoas": ["Matheus", "Juliana"], "telefone": ""}], ["convites", "familia-tia-lourdes-9kgm", {"codigo": "ftAKWEknFX", "enviado": false, "enviadoEm": "", "nome": "Família Tia Lourdes", "pessoas": ["Lourdes", "Soraya", "Frank"], "telefone": "", "eventos": ["casamento"]}], ["convites", "familia-vanda-jzs2", {"codigo": "vaGYxwRPkx", "enviado": false, "enviadoEm": "", "nome": "Família Vanda", "pessoas": ["Vanda", "Adriano"], "telefone": "", "eventos": ["casamento"]}], ["espera", "espera-xandinho-jk92", {"lado": "noivo", "nome": "Xandinho", "ordem": 1, "pessoas": ["Xandinho", "Esposa"], "telefone": ""}], ["espera", "espera-luiz-antonio-3i8s", {"lado": "", "nome": "Luiz Antônio", "ordem": 2, "pessoas": ["Luiz Antônio", "Elizabeth"], "telefone": ""}], ["itens", "geladeira", {"categoria": "Casa", "descricao": "Frost free, inox, 2 portas, ~450 L, 220V.", "emoji": "🧊", "fisico": false, "linkCartao": "", "nome": "Geladeira", "ordem": 0, "qtd": 1, "valor": 4200}], ["itens", "panela", {"categoria": "Casa", "descricao": "Para o Henrique aprender a cozinhar.", "emoji": "🍳", "linkCartao": "", "nome": "Jogo de panelas", "ordem": 1, "qtd": 1, "valor": 1}], ["itens", "airfryer", {"categoria": "Casa", "descricao": "A salvadora dos jantares de semana.", "emoji": "🍟", "fisico": true, "linkCartao": "", "nome": "Air fryer", "ordem": 2, "qtd": 1, "valor": 450}], ["itens", "jogocama", {"categoria": "Casa", "descricao": "Lençol que a gente não precisa brigar pra dividir.", "emoji": "🛏️", "linkCartao": "", "nome": "Jogo de cama", "ordem": 3, "qtd": 2, "valor": 220}], ["itens", "passagens", {"categoria": "Lua de mel", "descricao": "Cada cota nos leva um pouquinho mais longe.", "emoji": "✈️", "linkCartao": "", "nome": "Passagens da lua de mel", "ordem": 4, "qtd": 20, "valor": 250}], ["itens", "jantar", {"categoria": "Lua de mel", "descricao": "Com vista pro mar, de preferência.", "emoji": "🍷", "linkCartao": "", "nome": "Jantar romântico na lua de mel", "ordem": 5, "qtd": 3, "valor": 300}], ["itens", "pizza", {"categoria": "Divertidos", "descricao": "Tradição de domingo garantida.", "emoji": "🍕", "linkCartao": "", "nome": "Primeira pizza de casados", "ordem": 6, "qtd": 5, "valor": 90}], ["itens", "sogra", {"categoria": "Divertidos", "descricao": "Brincadeira! (Mas aceitamos.)", "emoji": "🛡️", "linkCartao": "", "nome": "Seguro contra visita surpresa da sogra", "ordem": 7, "qtd": 3, "valor": 150}], ["itens", "buffet", {"categoria": "Festa", "descricao": "Pra ninguém sair com fome da festa.", "emoji": "🎂", "linkCartao": "", "nome": "Ajuda no buffet", "ordem": 8, "qtd": 6, "valor": 500}], ["itens", "livre", {"categoria": "Lua de mel", "descricao": "Você escolhe quanto quer dar — tudo ajuda!", "emoji": "💝", "linkCartao": "", "livre": true, "nome": "Contribua com qualquer valor", "ordem": 9, "qtd": 1, "valor": 100}]];
let bancoPronto = false;
async function prepararBanco(db) {
  if (bancoPronto) return;
  await db.prepare("CREATE TABLE IF NOT EXISTS docs (col TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, atualizado TEXT NOT NULL, PRIMARY KEY (col, id))").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS fotos (id TEXT PRIMARY KEY, mime TEXT NOT NULL, data TEXT NOT NULL)").run();
  const tem = await db.prepare("SELECT COUNT(*) AS n FROM docs WHERE col <> 'segredo'").first();
  if (!tem || !tem.n) {
    for (const [col, id, data] of DADOS_INICIAIS) {
      await db.prepare("INSERT OR IGNORE INTO docs (col, id, data, atualizado) VALUES (?, ?, ?, ?)").bind(col, id, JSON.stringify(data), new Date().toISOString()).run();
    }
  }
  bancoPronto = true;
}

// ---------- rotas ----------
export async function onRequest(context) {
  const { request, env } = context;
  const db = env.DB;
  if (!db) return erro("Banco não configurado (ligação DB).", 500);
  try { await prepararBanco(db); } catch (e) { return erro("Não consegui preparar o banco.", 500); }
  const url = new URL(request.url);
  const partes = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  const metodo = request.method;

  try {
    // ===== público =====
    if (metodo === "GET" && partes[0] === "publico") {
      const [cfg, itens, gifts] = await Promise.all([config(db), listar(db, "itens"), listar(db, "gifts")]);
      const pub = {};
      for (const k of CFG_PUBLICO) if (cfg[k] !== undefined) pub[k] = cfg[k];
      return json({ cfg: pub, itens, uso: usoDosItens(gifts) });
    }

    if (metodo === "GET" && partes[0] === "convite" && partes[1]) {
      const cv = await conviteDoCodigo(db, partes[1]);
      if (!cv) return erro("Convite não encontrado.", 404);
      const resp = await pegar(db, "rsvp", cv.id + "__casamento");
      return json({
        convite: { id: cv.id, codigo: cv.codigo || cv.id, nome: cv.nome, pessoas: cv.pessoas || [] },
        resposta: resp ? { id: resp.id, respostas: resp.respostas || [], respondidoEm: resp.respondidoEm } : null,
      });
    }

    if (metodo === "POST" && partes[0] === "confirmar") {
      const b = await lerCorpo(request);
      const cfg = await config(db);
      if (prazoEncerrado(cfg)) return erro("O prazo de confirmação terminou.", 403);
      const cv = await conviteDoCodigo(db, b.codigo);
      if (!cv) return erro("Convite não encontrado.", 404);
      const pessoas = cv.pessoas || [];
      const recebidas = Array.isArray(b.respostas) ? b.respostas : [];
      const respostas = pessoas.map((n) => {
        const r = recebidas.find((x) => norm(x && x.nome) === norm(n));
        return r ? { nome: n, vai: !!r.vai } : null;
      });
      if (respostas.some((r) => !r)) return erro("Marque Vai ou Não vai para cada pessoa.");
      const id = cv.id + "__casamento";
      const antes = await pegar(db, "rsvp", id);
      const quando = agora();
      const doc = await gravar(db, "rsvp", id, { conviteId: cv.id, convite: cv.nome, evento: "casamento", respostas, respondidoEm: quando });
      // histórico
      const ant = (antes && antes.respostas) || [];
      const mudancas = respostas.map((r) => {
        const a = ant.find((x) => norm(x.nome) === norm(r.nome));
        const de = a ? (a.vai ? "vai" : "não vai") : "—", para = r.vai ? "vai" : "não vai";
        return de === para ? null : { nome: r.nome, de, para };
      }).filter(Boolean);
      if (mudancas.length || !antes) {
        const h = (await pegar(db, "historico", cv.id)) || { itens: [] };
        const itens = (h.itens || []).concat([{ em: quando, por: "convidado", mudancas }]).slice(-60);
        await gravar(db, "historico", cv.id, { itens });
      }
      return json({ ok: true, resposta: { id: doc.id, respostas: doc.respostas, respondidoEm: doc.respondidoEm } });
    }

    if (metodo === "POST" && partes[0] === "presente") {
      const b = await lerCorpo(request);
      const item = await pegar(db, "itens", texto(b.itemId, 80));
      if (!item) return erro("Presente não encontrado.", 404);
      const metodoPg = ["pix", "cartao", "fisico"].includes(b.metodo) ? b.metodo : null;
      if (!metodoPg) return erro("Forma de pagamento inválida.");
      if (metodoPg === "fisico" && !item.fisico) return erro("Este presente não aceita presente físico.");
      const nome = texto(b.nome, 80);
      if (!nome) return erro("Coloque seu nome, por favor.");
      const telefone = texto(b.telefone, 30);
      if (metodoPg === "fisico" && telefone.replace(/\D/g, "").length < 8) return erro("Coloque seu telefone para combinarmos a entrega.");
      const gifts = await listar(db, "gifts");
      const u = usoDosItens(gifts)[item.id] || { conf: 0, pend: 0 };
      const total = item.livre ? Infinity : Math.max(1, Number(item.qtd) || 1);
      const livres = total - u.conf - u.pend;
      const qtd = item.livre ? 1 : Math.max(1, Math.floor(Number(b.qtd) || 1));
      if (qtd > livres) return erro("Este presente acabou de ser escolhido por outra pessoa. Escolha outro, por favor.", 409);
      const cfg = await config(db);
      let base = item.livre ? Math.round((Number(b.valorLivre) || 0) * 100) / 100 : (Number(item.valor) || 0) * qtd;
      if (item.livre && (base < 1 || base > 100000)) return erro("Valor inválido.");
      const valor = metodoPg === "pix" ? base : metodoPg === "cartao" ? Math.round(base * (1 + (Number(cfg.acrescimo) || 0) / 100) * 100) / 100 : 0;
      const g = {
        itemId: item.id, itemNome: item.nome, qtd, valor, metodo: metodoPg, nome, telefone: metodoPg === "fisico" ? telefone : "",
        mensagem: texto(b.mensagem, 500), status: metodoPg === "fisico" ? "reservado" : "pendente", criadoEm: agora(), evento: "casamento",
      };
      await gravar(db, "gifts", idAleatorio(14), g);
      return json({ ok: true });
    }

    if (metodo === "GET" && partes[0] === "foto" && partes[1]) {
      const f = await db.prepare("SELECT mime, data FROM fotos WHERE id = ?").bind(partes[1]).first();
      if (!f) return new Response("não encontrada", { status: 404 });
      return new Response(base64ParaBytes(f.data), { headers: { "content-type": f.mime, "cache-control": "public, max-age=31536000, immutable" } });
    }

    // ===== noivos =====
    if (metodo === "POST" && partes[0] === "login") {
      const b = await lerCorpo(request);
      const senha = await senhaAtual(env, db);
      if (!senha) return erro("Senha ainda não cadastrada. Cadastre pelo Console do banco D1 (veja o README).", 500);
      await new Promise((r) => setTimeout(r, 600)); // freia tentativas em sequência
      const ok = iguais(await hmac("cmp", String(b.senha || "").trim()), await hmac("cmp", senha));
      if (!ok) return erro("Senha incorreta.", 401);
      return json({ token: await criarToken(senha) });
    }

    if (partes[0] === "admin") {
      const senhaVigente = await senhaAtual(env, db);
      if (!(await tokenValido(senhaVigente, request))) return erro("Entre novamente na Área dos noivos.", 401);

      if (metodo === "POST" && partes[1] === "senha") {
        if (env.SENHA) return erro("A senha está definida no painel da Cloudflare (SENHA). Altere por lá.", 400);
        const b = await lerCorpo(request);
        const nova = String(b.nova || "").trim();
        if (nova.length < 8) return erro("Use uma senha com pelo menos 8 caracteres.");
        await gravar(db, "segredo", "senha", { senha: nova });
        return json({ ok: true, token: await criarToken(nova) });
      }

      if (metodo === "GET" && partes[1] === "tudo") {
        const [cfg, itens, gifts, convites, rsvp, historico, espera] = await Promise.all(
          ["config", "itens", "gifts", "convites", "rsvp", "historico", "espera"].map((c) => listar(db, c))
        );
        return json({ cfg: (cfg.find((x) => x.id === "site") || {}), itens, gifts, convites, rsvp, historico, espera });
      }

      const col = partes[1], id = partes[2];
      if (!COLS[col] || !id || id.length > 120) return erro("Endereço inválido.", 404);
      if (col === "config" && id !== "site") return erro("Endereço inválido.", 404);

      if (metodo === "PUT") {
        const b = await lerCorpo(request);
        if (typeof b !== "object" || Array.isArray(b) || !b) return erro("Dados inválidos.");
        if (col === "config") { delete b.senhaHash; }
        if (col === "itens" && typeof b.imagem === "string" && b.imagem.startsWith("data:")) {
          const u = await guardarFoto(db, b.imagem);
          if (!u) return erro("Não consegui salvar essa foto. Tente uma imagem menor.");
          b.imagem = u;
        }
        const salvo = await gravar(db, col, id, b);
        return json({ ok: true, doc: salvo });
      }
      if (metodo === "DELETE") {
        await apagar(db, col, id);
        return json({ ok: true });
      }
      return erro("Método não permitido.", 405);
    }

    return erro("Não encontrado.", 404);
  } catch (e) {
    if (e && e.message === "grande") return erro("Envio grande demais.", 413);
    if (e instanceof SyntaxError) return erro("Dados inválidos.");
    return erro("Erro no servidor. Tente de novo.", 500);
  }
}
