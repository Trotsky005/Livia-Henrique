-- Banco do site do casamento (Cloudflare D1)
-- Cada registro é um documento JSON numa "coleção" (config, itens, gifts, convites, rsvp, historico, espera).
CREATE TABLE IF NOT EXISTS docs (
  col        TEXT NOT NULL,
  id         TEXT NOT NULL,
  data       TEXT NOT NULL,
  atualizado TEXT NOT NULL,
  PRIMARY KEY (col, id)
);

-- Fotos dos presentes (imagem reduzida, guardada em base64)
CREATE TABLE IF NOT EXISTS fotos (
  id   TEXT PRIMARY KEY,
  mime TEXT NOT NULL,
  data TEXT NOT NULL
);
