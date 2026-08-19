/**
 * Proxy vers le scraper enrichi (ebx/) — Description Builder desc-v2.
 * L’app racine (server.js / index.html) chargeait l’ancien template générique
 * (« Qualité premium sélectionnée », « Politique eBay »). On délègue tout à ebx/.
 */
module.exports = require("./ebx/scraper");
