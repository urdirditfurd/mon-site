// =============================================
// AgentVerse — Marketplace d'Agents IA
// Application Logic
// =============================================

// =============================================
// DATA — Agents IA
// =============================================

const agents = [
    {
        id: 1,
        name: "ChatGenius Pro",
        category: "chatbot",
        categoryLabel: "Chatbot & Assistant",
        description: "Agent conversationnel avancé pour le support client avec compréhension contextuelle et réponses multilingues.",
        longDescription: "ChatGenius Pro est un agent conversationnel de nouvelle génération qui comprend le contexte des conversations, gère les demandes complexes et répond en plus de 30 langues. Idéal pour le support client, il réduit le temps de réponse de 80% et améliore la satisfaction client.",
        price: 49,
        pricePeriod: "/mois",
        rating: 4.9,
        reviews: 234,
        sales: 1200,
        seller: "NeuralChat",
        sellerInitials: "NC",
        sellerColor: "#6366f1",
        badge: "popular",
        icon: "🤖",
        bgColor: "linear-gradient(135deg, #e0e7ff, #c7d2fe)",
        features: [
            "Support multilingue (30+ langues)",
            "Compréhension contextuelle avancée",
            "Intégration API en 5 minutes",
            "Dashboard analytique inclus",
            "Personnalisation complète du ton",
            "Escalade automatique vers un humain"
        ]
    },
    {
        id: 2,
        name: "DataMiner AI",
        category: "analyse",
        categoryLabel: "Analyse de Données",
        description: "Agent d'analyse de données qui transforme vos datasets en insights actionnables avec visualisations automatiques.",
        longDescription: "DataMiner AI analyse vos données brutes et génère automatiquement des rapports complets avec visualisations, tendances et recommandations. Compatible avec CSV, Excel, SQL et APIs. Parfait pour les équipes data qui veulent gagner du temps.",
        price: 79,
        pricePeriod: "/mois",
        rating: 4.8,
        reviews: 189,
        sales: 890,
        seller: "DataWiz",
        sellerInitials: "DW",
        sellerColor: "#10b981",
        badge: "popular",
        icon: "📊",
        bgColor: "linear-gradient(135deg, #d1fae5, #a7f3d0)",
        features: [
            "Analyse automatique de datasets",
            "Visualisations interactives",
            "Export PDF et PowerPoint",
            "Détection d'anomalies",
            "Prédictions et tendances",
            "Compatible SQL, CSV, Excel"
        ]
    },
    {
        id: 3,
        name: "ContentForge",
        category: "rédaction",
        categoryLabel: "Rédaction & Contenu",
        description: "Agent de rédaction IA qui génère du contenu SEO-optimisé pour blogs, réseaux sociaux et emails marketing.",
        longDescription: "ContentForge génère du contenu professionnel optimisé pour le SEO. Articles de blog, posts réseaux sociaux, emails marketing, descriptions produits — tout est possible. L'agent apprend votre ton de marque et s'améliore avec le temps.",
        price: 39,
        pricePeriod: "/mois",
        rating: 4.7,
        reviews: 312,
        sales: 1540,
        seller: "WriteBot",
        sellerInitials: "WB",
        sellerColor: "#ec4899",
        badge: "hot",
        icon: "✍️",
        bgColor: "linear-gradient(135deg, #fce7f3, #fbcfe8)",
        features: [
            "Contenu SEO-optimisé",
            "Ton de marque personnalisable",
            "Multi-format (blog, social, email)",
            "Suggestions de mots-clés",
            "Vérification anti-plagiat",
            "Planificateur éditorial IA"
        ]
    },
    {
        id: 4,
        name: "FlowBot Automate",
        category: "automatisation",
        categoryLabel: "Automatisation",
        description: "Agent d'automatisation no-code qui connecte vos apps et automatise vos workflows complexes sans écrire une ligne de code.",
        longDescription: "FlowBot Automate est un agent d'automatisation puissant qui connecte plus de 200 applications. Créez des workflows complexes en langage naturel, sans aucune compétence technique. De la gestion d'emails à la synchronisation CRM, tout devient automatique.",
        price: 59,
        pricePeriod: "/mois",
        rating: 4.9,
        reviews: 276,
        sales: 980,
        seller: "AutoFlow",
        sellerInitials: "AF",
        sellerColor: "#f59e0b",
        badge: "popular",
        icon: "⚡",
        bgColor: "linear-gradient(135deg, #fef3c7, #fde68a)",
        features: [
            "200+ intégrations d'apps",
            "Création en langage naturel",
            "Workflows conditionnels",
            "Planification temporelle",
            "Logs et monitoring",
            "Templates prêts à l'emploi"
        ]
    },
    {
        id: 5,
        name: "CodePilot X",
        category: "code",
        categoryLabel: "Code & Développement",
        description: "Agent développeur qui génère, review et corrige du code dans plus de 20 langages de programmation.",
        longDescription: "CodePilot X est votre pair-programmeur IA. Il génère du code propre, effectue des code reviews détaillées, corrige les bugs et écrit des tests unitaires. Supporte Python, JavaScript, TypeScript, Go, Rust et 15+ autres langages.",
        price: 69,
        pricePeriod: "/mois",
        rating: 4.8,
        reviews: 198,
        sales: 750,
        seller: "DevForge",
        sellerInitials: "DF",
        sellerColor: "#8b5cf6",
        badge: "new",
        icon: "💻",
        bgColor: "linear-gradient(135deg, #ede9fe, #ddd6fe)",
        features: [
            "20+ langages supportés",
            "Code review automatique",
            "Génération de tests unitaires",
            "Détection et correction de bugs",
            "Documentation auto-générée",
            "Intégration IDE (VS Code, JetBrains)"
        ]
    },
    {
        id: 6,
        name: "LeadHunter Pro",
        category: "marketing",
        categoryLabel: "Marketing & Ventes",
        description: "Agent de génération de leads qui identifie et qualifie vos prospects idéaux grâce à l'IA prédictive.",
        longDescription: "LeadHunter Pro utilise l'IA prédictive pour identifier les prospects les plus qualifiés pour votre entreprise. Il scrape les données publiques, enrichit les profils et score les leads automatiquement. Intégration directe avec Salesforce, HubSpot et Pipedrive.",
        price: 99,
        pricePeriod: "/mois",
        rating: 4.6,
        reviews: 145,
        sales: 620,
        seller: "GrowthAI",
        sellerInitials: "GA",
        sellerColor: "#f97316",
        badge: "hot",
        icon: "🎯",
        bgColor: "linear-gradient(135deg, #ffedd5, #fed7aa)",
        features: [
            "IA prédictive de scoring",
            "Enrichissement de données",
            "Intégration CRM native",
            "Campagnes email automatisées",
            "Rapports de conversion",
            "A/B testing intégré"
        ]
    },
    {
        id: 7,
        name: "TranslateBot Ultra",
        category: "rédaction",
        categoryLabel: "Rédaction & Contenu",
        description: "Agent de traduction IA qui localise vos contenus dans 50+ langues avec une précision contextuelle inégalée.",
        longDescription: "TranslateBot Ultra va bien au-delà de la traduction mot-à-mot. Il comprend le contexte, adapte le ton culturel et préserve le sens original. Idéal pour les sites web, apps, documents marketing et contenus juridiques.",
        price: 29,
        pricePeriod: "/mois",
        rating: 4.7,
        reviews: 267,
        sales: 1100,
        seller: "LinguaAI",
        sellerInitials: "LA",
        sellerColor: "#06b6d4",
        badge: "popular",
        icon: "🌍",
        bgColor: "linear-gradient(135deg, #cffafe, #a5f3fc)",
        features: [
            "50+ langues supportées",
            "Adaptation culturelle",
            "Mémoire de traduction",
            "Glossaire personnalisé",
            "API batch disponible",
            "Validation humaine optionnelle"
        ]
    },
    {
        id: 8,
        name: "VisionAnalyze",
        category: "analyse",
        categoryLabel: "Analyse de Données",
        description: "Agent de vision par ordinateur qui analyse images et vidéos pour en extraire des données structurées.",
        longDescription: "VisionAnalyze utilise la vision par ordinateur pour analyser vos images et vidéos. Reconnaissance d'objets, OCR, détection de défauts, comptage automatique — transformez le visuel en données exploitables pour votre business.",
        price: 89,
        pricePeriod: "/mois",
        rating: 4.5,
        reviews: 98,
        sales: 340,
        seller: "SightAI",
        sellerInitials: "SA",
        sellerColor: "#10b981",
        badge: "new",
        icon: "👁️",
        bgColor: "linear-gradient(135deg, #d1fae5, #6ee7b7)",
        features: [
            "Reconnaissance d'objets",
            "OCR haute précision",
            "Analyse vidéo en temps réel",
            "Détection de défauts",
            "Classification d'images",
            "API REST documentée"
        ]
    },
    {
        id: 9,
        name: "MailMaster AI",
        category: "automatisation",
        categoryLabel: "Automatisation",
        description: "Agent qui gère votre boîte email : tri intelligent, réponses automatiques et résumés quotidiens.",
        longDescription: "MailMaster AI transforme la gestion de vos emails. Il trie automatiquement par priorité, rédige des réponses contextuelles, et vous envoie un résumé quotidien des emails importants. Réduisez le temps passé sur vos emails de 60%.",
        price: 19,
        pricePeriod: "/mois",
        rating: 4.8,
        reviews: 456,
        sales: 2100,
        seller: "InboxZero",
        sellerInitials: "IZ",
        sellerColor: "#6366f1",
        badge: "hot",
        icon: "📧",
        bgColor: "linear-gradient(135deg, #e0e7ff, #c7d2fe)",
        features: [
            "Tri intelligent par priorité",
            "Réponses automatiques contextuelles",
            "Résumé quotidien",
            "Détection de spam avancée",
            "Compatible Gmail & Outlook",
            "Respect de la confidentialité"
        ]
    },
    {
        id: 10,
        name: "SocialPulse",
        category: "marketing",
        categoryLabel: "Marketing & Ventes",
        description: "Agent de gestion des réseaux sociaux avec planification, création de contenu et analytics unifiés.",
        longDescription: "SocialPulse gère l'ensemble de votre présence sur les réseaux sociaux. Il crée du contenu adapté à chaque plateforme, planifie les publications aux heures optimales et analyse les performances. Un community manager IA 24/7.",
        price: 45,
        pricePeriod: "/mois",
        rating: 4.6,
        reviews: 178,
        sales: 830,
        seller: "SocialGenius",
        sellerInitials: "SG",
        sellerColor: "#ec4899",
        badge: "popular",
        icon: "📱",
        bgColor: "linear-gradient(135deg, #fce7f3, #f9a8d4)",
        features: [
            "Multi-plateforme (IG, TW, LI, TT)",
            "Création de contenu IA",
            "Planification optimale",
            "Analytics unifiés",
            "Réponses automatiques",
            "Veille concurrentielle"
        ]
    },
    {
        id: 11,
        name: "LegalBot Assistant",
        category: "chatbot",
        categoryLabel: "Chatbot & Assistant",
        description: "Agent juridique IA qui analyse vos contrats, identifie les risques et génère des documents légaux.",
        longDescription: "LegalBot Assistant est votre conseiller juridique IA. Il analyse les contrats en quelques secondes, identifie les clauses à risque, et génère des documents légaux conformes. Idéal pour les PME qui n'ont pas de service juridique dédié.",
        price: 129,
        pricePeriod: "/mois",
        rating: 4.7,
        reviews: 89,
        sales: 410,
        seller: "LexAI",
        sellerInitials: "LX",
        sellerColor: "#334155",
        badge: "new",
        icon: "⚖️",
        bgColor: "linear-gradient(135deg, #e2e8f0, #cbd5e1)",
        features: [
            "Analyse de contrats automatique",
            "Détection de clauses à risque",
            "Génération de documents légaux",
            "Base de données juridique",
            "Conformité RGPD intégrée",
            "Veille réglementaire"
        ]
    },
    {
        id: 12,
        name: "RecruiterAI",
        category: "automatisation",
        categoryLabel: "Automatisation",
        description: "Agent de recrutement qui trie les CV, planifie les entretiens et évalue les candidats automatiquement.",
        longDescription: "RecruiterAI révolutionne votre processus de recrutement. Il analyse les CV en masse, matche les profils avec vos offres, planifie les entretiens et génère des évaluations objectives. Réduisez votre temps de recrutement de 70%.",
        price: 79,
        pricePeriod: "/mois",
        rating: 4.5,
        reviews: 134,
        sales: 560,
        seller: "HireWise",
        sellerInitials: "HW",
        sellerColor: "#f59e0b",
        badge: "popular",
        icon: "👔",
        bgColor: "linear-gradient(135deg, #fef3c7, #fcd34d)",
        features: [
            "Tri automatique de CV",
            "Matching IA poste/candidat",
            "Planification d'entretiens",
            "Évaluations objectives",
            "Intégration ATS",
            "Rapports diversité"
        ]
    }
];

// =============================================
// STATE
// =============================================

let currentFilter = 'all';
let visibleCount = 6;
const ITEMS_PER_LOAD = 6;

// User / Auth state
let isLoggedIn = false;
let currentUser = null;

// Sell flow state
let sellStep = 1;
let selectedEmoji = '🤖';
let selectedPricingModel = 'monthly';
let iconMode = 'emoji'; // 'emoji' or 'upload'
let uploadedImageDataUrl = null; // base64 data url of uploaded image

// Cart state
let cart = [];

// Category label map
const categoryLabels = {
    'chatbot': 'Chatbot & Assistant',
    'automatisation': 'Automatisation',
    'analyse': 'Analyse de Données',
    'rédaction': 'Rédaction & Contenu',
    'code': 'Code & Développement',
    'marketing': 'Marketing & Ventes'
};

// Random colors for seller avatars
const avatarColors = ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#f97316', '#06b6d4', '#ef4444'];

// BG colors per category
const categoryBgColors = {
    'chatbot': 'linear-gradient(135deg, #e0e7ff, #c7d2fe)',
    'automatisation': 'linear-gradient(135deg, #fef3c7, #fde68a)',
    'analyse': 'linear-gradient(135deg, #d1fae5, #a7f3d0)',
    'rédaction': 'linear-gradient(135deg, #fce7f3, #fbcfe8)',
    'code': 'linear-gradient(135deg, #ede9fe, #ddd6fe)',
    'marketing': 'linear-gradient(135deg, #ffedd5, #fed7aa)'
};

// =============================================
// DOM ELEMENTS
// =============================================

const agentsGrid = document.getElementById('agentsGrid');
const loadMoreBtn = document.getElementById('loadMore');
const heroSearch = document.getElementById('heroSearch');
const filterTabs = document.querySelectorAll('.filter-tab');
const sortSelect = document.getElementById('sortSelect');
const agentModal = document.getElementById('agentModal');
const modalBody = document.getElementById('modalBody');
const modalClose = document.getElementById('modalClose');
const authModal = document.getElementById('authModal');
const authModalClose = document.getElementById('authModalClose');
const btnLogin = document.getElementById('btnLogin');
const btnSignup = document.getElementById('btnSignup');
const hamburger = document.getElementById('hamburger');
const navLinks = document.getElementById('navLinks');
const navbar = document.getElementById('navbar');
const toastContainer = document.getElementById('toastContainer');
const categoryCards = document.querySelectorAll('.category-card');
const searchTags = document.querySelectorAll('.tag');

// Sell modal elements
const sellModal = document.getElementById('sellModal');
const sellModalClose = document.getElementById('sellModalClose');

// Cart elements
const navCartBtn = document.getElementById('navCart');
const cartBadge = document.getElementById('cartBadge');
const cartDropdown = document.getElementById('cartDropdown');
const cartItemsEl = document.getElementById('cartItems');
const cartFooter = document.getElementById('cartFooter');
const cartTotalEl = document.getElementById('cartTotal');
const cartClearAll = document.getElementById('cartClearAll');
const cartCheckout = document.getElementById('cartCheckout');

// Nav auth sections
const navAuthLoggedOut = document.getElementById('navAuthLoggedOut');
const navAuthLoggedIn = document.getElementById('navAuthLoggedIn');
const navUserInitials = document.getElementById('navUserInitials');

// =============================================
// RENDER AGENTS
// =============================================

function getFilteredAgents() {
    let filtered = [...agents];

    if (currentFilter !== 'all') {
        filtered = filtered.filter(a => a.category === currentFilter);
    }

    // Search
    const query = heroSearch.value.toLowerCase().trim();
    if (query) {
        filtered = filtered.filter(a =>
            a.name.toLowerCase().includes(query) ||
            a.category.toLowerCase().includes(query) ||
            a.categoryLabel.toLowerCase().includes(query) ||
            a.description.toLowerCase().includes(query)
        );
    }

    // Sort
    const sort = sortSelect.value;
    switch (sort) {
        case 'popular':
            filtered.sort((a, b) => b.sales - a.sales);
            break;
        case 'recent':
            filtered.sort((a, b) => b.id - a.id);
            break;
        case 'price-asc':
            filtered.sort((a, b) => a.price - b.price);
            break;
        case 'price-desc':
            filtered.sort((a, b) => b.price - a.price);
            break;
        case 'rating':
            filtered.sort((a, b) => b.rating - a.rating);
            break;
    }

    return filtered;
}

function renderAgents() {
    const filtered = getFilteredAgents();
    const toShow = filtered.slice(0, visibleCount);

    agentsGrid.innerHTML = toShow.map(agent => {
        const visualContent = agent.imageUrl
            ? `<img src="${agent.imageUrl}" alt="${agent.name}" style="width: 80px; height: 80px; object-fit: cover; border-radius: 12px;">`
            : agent.icon;
        return `
        <div class="agent-card" data-id="${agent.id}">
            <div class="agent-card-header" style="background: ${agent.bgColor}">
                <div class="agent-visual">${visualContent}</div>
                <span class="agent-card-badge badge-${agent.badge}">
                    ${agent.badge === 'popular' ? '★ Populaire' : agent.badge === 'new' ? '✦ Nouveau' : '🔥 Tendance'}
                </span>
            </div>
            <div class="agent-card-body">
                <div class="agent-card-category">${agent.categoryLabel}</div>
                <div class="agent-seller">
                    <div class="seller-avatar" style="background: ${agent.sellerColor}">${agent.sellerInitials}</div>
                    <span class="seller-name">par <strong>${agent.seller}</strong></span>
                </div>
                <h3 class="agent-card-title">${agent.name}</h3>
                <p class="agent-card-desc">${agent.description}</p>
                <div class="agent-card-meta">
                    <div class="agent-rating">
                        <i class="fas fa-star"></i>
                        ${agent.rating}
                        <span>(${agent.reviews})</span>
                    </div>
                    <div class="agent-price">
                        €${agent.price}<span class="price-period">${agent.pricePeriod}</span>
                    </div>
                </div>
            </div>
        </div>
    `}).join('');

    // Show/hide load more
    if (filtered.length <= visibleCount) {
        loadMoreBtn.style.display = 'none';
    } else {
        loadMoreBtn.style.display = 'inline-flex';
    }

    // Animate cards in
    requestAnimationFrame(() => {
        document.querySelectorAll('.agent-card').forEach((card, i) => {
            card.style.opacity = '0';
            card.style.transform = 'translateY(20px)';
            card.style.transition = `all 0.4s ease ${i * 0.06}s`;
            requestAnimationFrame(() => {
                card.style.opacity = '1';
                card.style.transform = 'translateY(0)';
            });
        });
    });

    // Attach click
    document.querySelectorAll('.agent-card').forEach(card => {
        card.addEventListener('click', () => {
            const id = parseInt(card.dataset.id);
            openAgentModal(id);
        });
    });
}

// =============================================
// AGENT MODAL
// =============================================

function openAgentModal(id) {
    const agent = agents.find(a => a.id === id);
    if (!agent) return;

    const modalIconContent = agent.imageUrl
        ? `<img src="${agent.imageUrl}" alt="${agent.name}" style="width: 60px; height: 60px; object-fit: cover; border-radius: 12px;">`
        : agent.icon;

    modalBody.innerHTML = `
        <div class="modal-agent-header">
            <div class="modal-agent-icon" style="background: ${agent.bgColor}; font-size: 36px; display: flex; align-items: center; justify-content: center;">
                ${modalIconContent}
            </div>
            <div class="modal-agent-info">
                <div class="modal-category">${agent.categoryLabel}</div>
                <h2>${agent.name}</h2>
                <p class="modal-seller">par <strong>${agent.seller}</strong> · <i class="fas fa-star" style="color: #f59e0b;"></i> ${agent.rating} (${agent.reviews} avis)</p>
            </div>
        </div>

        <div class="modal-stats">
            <div class="modal-stat">
                <div class="modal-stat-value">€${agent.price}</div>
                <div class="modal-stat-label">par mois</div>
            </div>
            <div class="modal-stat">
                <div class="modal-stat-value">${agent.sales.toLocaleString()}</div>
                <div class="modal-stat-label">ventes</div>
            </div>
            <div class="modal-stat">
                <div class="modal-stat-value">${agent.rating}</div>
                <div class="modal-stat-label">note moyenne</div>
            </div>
        </div>

        <div class="modal-description">
            <h3>Description</h3>
            <p>${agent.longDescription}</p>
        </div>

        <div class="modal-description">
            <h3>Fonctionnalités incluses</h3>
        </div>
        <ul class="modal-features">
            ${agent.features.map(f => `<li><i class="fas fa-check-circle"></i> ${f}</li>`).join('')}
        </ul>

        <div class="modal-actions">
            <button class="btn btn-primary btn-lg" onclick="handleBuy(${agent.id})">
                <i class="fas fa-cart-plus"></i> Ajouter au panier — €${agent.price}${agent.pricePeriod}
            </button>
            <button class="btn btn-outline btn-lg" onclick="handleDemo(${agent.id})">
                <i class="fas fa-play"></i> Démo gratuite
            </button>
        </div>
    `;

    agentModal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeModal(modal) {
    modal.classList.remove('active');
    document.body.style.overflow = '';
}

// =============================================
// TOAST NOTIFICATIONS
// =============================================

function showToast(message, type = 'info') {
    const icons = {
        success: 'fas fa-check-circle',
        error: 'fas fa-exclamation-circle',
        info: 'fas fa-info-circle'
    };

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<i class="${icons[type]}"></i> ${message}`;
    toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 3000);
}

// =============================================
// AUTH / LOGIN SYSTEM
// =============================================

function loginUser(name, email, brand) {
    isLoggedIn = true;
    const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
    currentUser = {
        name: name,
        email: email,
        brand: brand || name.split(' ')[0] + 'AI',
        initials: initials,
        color: avatarColors[Math.floor(Math.random() * avatarColors.length)]
    };

    // Update navbar
    navAuthLoggedOut.classList.add('hidden');
    navAuthLoggedIn.classList.remove('hidden');
    navUserInitials.textContent = currentUser.initials;

    showToast(`Bienvenue ${currentUser.name} ! Vous êtes connecté.`, 'success');
}

function logoutUser() {
    isLoggedIn = false;
    currentUser = null;
    navAuthLoggedOut.classList.remove('hidden');
    navAuthLoggedIn.classList.add('hidden');
    showToast('Vous avez été déconnecté.', 'info');
}

// =============================================
// SELL FLOW — Multi-Step
// =============================================

function openSellModal() {
    sellStep = 1;
    // If already logged in, skip to step 2
    if (isLoggedIn) {
        sellStep = 2;
    }
    resetSellForm();
    updateSellStep();
    sellModal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function resetSellForm() {
    // Reset form fields (only if they exist)
    const fields = ['sellerName', 'sellerEmail', 'sellerPassword', 'sellerBrand',
                     'agentName', 'agentCategory', 'agentShortDesc', 'agentLongDesc',
                     'agentFeatures', 'agentPrice', 'agentDiscount', 'agentDemoUrl', 'agentDocsUrl',
                     'customCategoryName'];
    fields.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    selectedEmoji = '🤖';
    selectedPricingModel = 'monthly';
    iconMode = 'emoji';
    uploadedImageDataUrl = null;

    const countEl = document.getElementById('shortDescCount');
    if (countEl) countEl.textContent = '0';

    // Reset custom category
    const customWrapper = document.getElementById('customCategoryWrapper');
    if (customWrapper) customWrapper.classList.add('hidden');

    // Reset icon mode tabs
    document.querySelectorAll('.icon-mode-tab').forEach(t => t.classList.remove('active'));
    const emojiTab = document.querySelector('.icon-mode-tab[data-mode="emoji"]');
    if (emojiTab) emojiTab.classList.add('active');
    const emojiContent = document.getElementById('iconModeEmoji');
    const uploadContent = document.getElementById('iconModeUpload');
    if (emojiContent) emojiContent.classList.remove('hidden');
    if (uploadContent) uploadContent.classList.add('hidden');

    // Reset emoji selection
    document.querySelectorAll('.emoji-btn').forEach(b => b.classList.remove('selected'));
    const firstEmoji = document.querySelector('.emoji-btn[data-emoji="🤖"]');
    if (firstEmoji) firstEmoji.classList.add('selected');

    // Reset upload preview
    const placeholder = document.getElementById('uploadPlaceholder');
    const preview = document.getElementById('uploadPreview');
    const imgInput = document.getElementById('agentImageInput');
    if (placeholder) placeholder.classList.remove('hidden');
    if (preview) preview.classList.add('hidden');
    if (imgInput) imgInput.value = '';
}

function updateSellStep() {
    // Update step dots
    document.querySelectorAll('.sell-step-dot').forEach(dot => {
        const step = parseInt(dot.dataset.step);
        dot.classList.remove('active', 'done');
        if (step === sellStep) dot.classList.add('active');
        else if (step < sellStep) dot.classList.add('done');
    });

    // Update step lines
    const lines = document.querySelectorAll('.sell-step-line');
    lines.forEach((line, i) => {
        if (i + 1 < sellStep) {
            line.classList.add('active');
        } else {
            line.classList.remove('active');
        }
    });

    // Show/hide steps
    for (let i = 1; i <= 4; i++) {
        const stepEl = document.getElementById(`sellStep${i}`);
        if (stepEl) {
            if (i === sellStep) {
                stepEl.classList.remove('hidden');
                stepEl.style.animation = 'none';
                stepEl.offsetHeight; // trigger reflow
                stepEl.style.animation = 'fadeInUp 0.4s ease';
            } else {
                stepEl.classList.add('hidden');
            }
        }
    }

    // If step 4 (preview), render the preview
    if (sellStep === 4) {
        renderSellPreview();
    }
}

function validateSellStep1() {
    const name = document.getElementById('sellerName').value.trim();
    const email = document.getElementById('sellerEmail').value.trim();
    const password = document.getElementById('sellerPassword').value.trim();
    const brand = document.getElementById('sellerBrand').value.trim();

    if (!name) {
        showToast('Veuillez entrer votre nom complet.', 'error');
        document.getElementById('sellerName').focus();
        return false;
    }
    if (!email || !email.includes('@')) {
        showToast('Veuillez entrer une adresse email valide.', 'error');
        document.getElementById('sellerEmail').focus();
        return false;
    }
    if (!password || password.length < 8) {
        showToast('Le mot de passe doit contenir au moins 8 caractères.', 'error');
        document.getElementById('sellerPassword').focus();
        return false;
    }
    if (!brand) {
        showToast('Veuillez entrer un nom de vendeur / marque.', 'error');
        document.getElementById('sellerBrand').focus();
        return false;
    }

    // Simulate login
    loginUser(name, email, brand);
    return true;
}

function getSelectedCategory() {
    const select = document.getElementById('agentCategory');
    const val = select.value;
    if (val === '__custom__') {
        const customName = document.getElementById('customCategoryName').value.trim();
        if (!customName) return { key: '', label: '' };
        // Create a slug-like key
        const key = customName.toLowerCase().replace(/[^a-zà-ÿ0-9]/gi, '-').replace(/-+/g, '-');
        return { key: key, label: customName };
    }
    return { key: val, label: categoryLabels[val] || val };
}

function validateSellStep2() {
    const name = document.getElementById('agentName').value.trim();
    const catSelect = document.getElementById('agentCategory').value;
    const shortDesc = document.getElementById('agentShortDesc').value.trim();
    const longDesc = document.getElementById('agentLongDesc').value.trim();
    const features = document.getElementById('agentFeatures').value.trim();

    if (!name) {
        showToast('Veuillez entrer le nom de votre agent.', 'error');
        document.getElementById('agentName').focus();
        return false;
    }
    if (!catSelect) {
        showToast('Veuillez choisir une catégorie.', 'error');
        document.getElementById('agentCategory').focus();
        return false;
    }
    if (catSelect === '__custom__') {
        const customName = document.getElementById('customCategoryName').value.trim();
        if (!customName) {
            showToast('Veuillez entrer le nom de votre nouvelle catégorie.', 'error');
            document.getElementById('customCategoryName').focus();
            return false;
        }
    }
    if (!shortDesc) {
        showToast('Veuillez entrer une description courte.', 'error');
        document.getElementById('agentShortDesc').focus();
        return false;
    }
    if (!longDesc) {
        showToast('Veuillez entrer une description complète.', 'error');
        document.getElementById('agentLongDesc').focus();
        return false;
    }
    if (!features) {
        showToast('Veuillez lister au moins une fonctionnalité.', 'error');
        document.getElementById('agentFeatures').focus();
        return false;
    }

    return true;
}

function validateSellStep3() {
    const price = document.getElementById('agentPrice').value;
    if (!price || parseFloat(price) <= 0) {
        showToast('Veuillez entrer un prix valide supérieur à 0€.', 'error');
        document.getElementById('agentPrice').focus();
        return false;
    }
    return true;
}

function getPricePeriod() {
    if (selectedPricingModel === 'monthly') return '/mois';
    if (selectedPricingModel === 'onetime') return '';
    return '/mois'; // freemium
}

function getAgentIconHtml(size = 56) {
    if (iconMode === 'upload' && uploadedImageDataUrl) {
        return `<img src="${uploadedImageDataUrl}" alt="Agent" style="width: ${size}px; height: ${size}px; object-fit: cover; border-radius: 12px;">`;
    }
    return `<span style="font-size: ${size}px; line-height: 1;">${selectedEmoji}</span>`;
}

function renderSellPreview() {
    const name = document.getElementById('agentName').value.trim();
    const { key: category, label: catLabel } = getSelectedCategory();
    const shortDesc = document.getElementById('agentShortDesc').value.trim();
    const longDesc = document.getElementById('agentLongDesc').value.trim();
    const features = document.getElementById('agentFeatures').value.trim().split('\n').filter(f => f.trim());
    const price = parseFloat(document.getElementById('agentPrice').value) || 0;
    const discount = parseFloat(document.getElementById('agentDiscount').value) || 0;
    const demoUrl = document.getElementById('agentDemoUrl').value.trim();
    const docsUrl = document.getElementById('agentDocsUrl').value.trim();
    const pricePeriod = getPricePeriod();
    const bgColor = categoryBgColors[category] || 'linear-gradient(135deg, #e0e7ff, #c7d2fe)';

    const finalPrice = discount > 0 ? Math.round(price * (1 - discount / 100)) : price;

    const previewCard = document.getElementById('previewCard');
    previewCard.innerHTML = `
        <div class="agent-card-header" style="background: ${bgColor}">
            <div class="agent-visual">${getAgentIconHtml(56)}</div>
            <span class="agent-card-badge badge-new">✦ Nouveau</span>
        </div>
        <div class="agent-card-body">
            <div class="agent-card-category">${catLabel}</div>
            <div class="agent-seller">
                <div class="seller-avatar" style="background: ${currentUser.color}">${currentUser.initials}</div>
                <span class="seller-name">par <strong>${currentUser.brand}</strong></span>
            </div>
            <h3 class="agent-card-title">${name}</h3>
            <p class="agent-card-desc">${shortDesc}</p>
            <div class="agent-card-meta">
                <div class="agent-rating">
                    <i class="fas fa-star"></i> Nouveau
                </div>
                <div class="agent-price">
                    €${finalPrice}<span class="price-period">${pricePeriod}</span>
                </div>
            </div>
        </div>
    `;

    const pricingModelLabel = selectedPricingModel === 'monthly' ? 'Abonnement mensuel' :
                               selectedPricingModel === 'onetime' ? 'Achat unique' : 'Freemium';

    const previewDetails = document.getElementById('previewDetails');
    previewDetails.innerHTML = `
        <h3 class="preview-label"><i class="fas fa-clipboard-list"></i> Récapitulatif complet</h3>
        <div class="preview-details-grid">
            <div class="preview-detail-item">
                <div class="detail-label">Nom de l'agent</div>
                <div class="detail-value">${name}</div>
            </div>
            <div class="preview-detail-item">
                <div class="detail-label">Catégorie</div>
                <div class="detail-value">${catLabel}</div>
            </div>
            <div class="preview-detail-item">
                <div class="detail-label">Modèle tarifaire</div>
                <div class="detail-value">${pricingModelLabel}</div>
            </div>
            <div class="preview-detail-item">
                <div class="detail-label">Prix</div>
                <div class="detail-value">€${finalPrice}${pricePeriod}${discount > 0 ? ' <span style="color:#10b981; font-size:12px;">(-' + discount + '%)</span>' : ''}</div>
            </div>
            <div class="preview-detail-item">
                <div class="detail-label">Vendeur</div>
                <div class="detail-value">${currentUser.brand}</div>
            </div>
            <div class="preview-detail-item">
                <div class="detail-label">Vos revenus / vente</div>
                <div class="detail-value" style="color: #10b981;">€${Math.round(finalPrice * 0.85 * 100) / 100}</div>
            </div>
        </div>
        <div style="margin-top: 20px;">
            <div class="preview-detail-item" style="margin-bottom: 12px;">
                <div class="detail-label">Description</div>
                <div class="detail-value" style="font-weight: 400; font-size: 14px; line-height: 1.6; color: #475569;">${longDesc}</div>
            </div>
            <div class="preview-detail-item">
                <div class="detail-label">Fonctionnalités (${features.length})</div>
                <div class="detail-value" style="font-weight: 400; font-size: 14px;">
                    ${features.map(f => `<div style="padding: 4px 0; color: #475569;"><i class="fas fa-check-circle" style="color: #10b981; margin-right: 8px;"></i>${f.trim()}</div>`).join('')}
                </div>
            </div>
            ${demoUrl ? `<div class="preview-detail-item" style="margin-top: 12px;"><div class="detail-label">Lien de démo</div><div class="detail-value" style="font-size: 14px; color: #6366f1;">${demoUrl}</div></div>` : ''}
            ${docsUrl ? `<div class="preview-detail-item" style="margin-top: 12px;"><div class="detail-label">Documentation</div><div class="detail-value" style="font-size: 14px; color: #6366f1;">${docsUrl}</div></div>` : ''}
        </div>
    `;
}

function publishAgent() {
    const name = document.getElementById('agentName').value.trim();
    const { key: category, label: catLabel } = getSelectedCategory();
    const shortDesc = document.getElementById('agentShortDesc').value.trim();
    const longDesc = document.getElementById('agentLongDesc').value.trim();
    const features = document.getElementById('agentFeatures').value.trim().split('\n').filter(f => f.trim()).map(f => f.trim());
    const price = parseFloat(document.getElementById('agentPrice').value) || 0;
    const discount = parseFloat(document.getElementById('agentDiscount').value) || 0;
    const pricePeriod = getPricePeriod();
    const bgColor = categoryBgColors[category] || 'linear-gradient(135deg, #e0e7ff, #c7d2fe)';
    const finalPrice = discount > 0 ? Math.round(price * (1 - discount / 100)) : price;

    // If custom category, register it
    if (!categoryLabels[category] && catLabel) {
        categoryLabels[category] = catLabel;
        categoryBgColors[category] = 'linear-gradient(135deg, #e0e7ff, #c7d2fe)';
    }

    // Determine icon: emoji or uploaded image
    let agentIcon = selectedEmoji;
    let agentImageUrl = null;
    if (iconMode === 'upload' && uploadedImageDataUrl) {
        agentIcon = ''; // no emoji
        agentImageUrl = uploadedImageDataUrl;
    }

    // Create new agent object
    const newAgent = {
        id: agents.length + 1,
        name: name,
        category: category,
        categoryLabel: catLabel,
        description: shortDesc,
        longDescription: longDesc,
        price: finalPrice,
        pricePeriod: pricePeriod,
        rating: 0,
        reviews: 0,
        sales: 0,
        seller: currentUser.brand,
        sellerInitials: currentUser.initials,
        sellerColor: currentUser.color,
        badge: 'new',
        icon: agentIcon,
        imageUrl: agentImageUrl,
        bgColor: bgColor,
        features: features.slice(0, 6)
    };

    // Add to agents array
    agents.unshift(newAgent);

    // Close modal
    closeModal(sellModal);

    // Show success
    showToast(`"${name}" a été publié avec succès ! Il sera visible après validation.`, 'success');

    // Re-render
    currentFilter = 'all';
    filterTabs.forEach(t => {
        t.classList.remove('active');
        if (t.dataset.filter === 'all') t.classList.add('active');
    });
    visibleCount = 6;
    renderAgents();

    // Scroll to marketplace
    setTimeout(() => {
        document.getElementById('marketplace').scrollIntoView({ behavior: 'smooth' });
    }, 500);
}

function updatePricingSummary() {
    const price = parseFloat(document.getElementById('agentPrice').value) || 0;
    const discount = parseFloat(document.getElementById('agentDiscount').value) || 0;
    const pricePeriod = getPricePeriod();

    const finalPrice = discount > 0 ? Math.round(price * (1 - discount / 100)) : price;
    const commission = Math.round(finalPrice * 0.15 * 100) / 100;
    const earnings = Math.round(finalPrice * 0.85 * 100) / 100;

    const displayPriceEl = document.getElementById('displayPrice');
    const commissionEl = document.getElementById('commissionAmount');
    const earningsEl = document.getElementById('sellerEarnings');

    if (displayPriceEl) {
        displayPriceEl.textContent = `€${finalPrice}${pricePeriod}`;
        if (discount > 0) {
            displayPriceEl.innerHTML = `<span style="text-decoration: line-through; color: #94a3b8; margin-right: 8px;">€${price}</span> €${finalPrice}${pricePeriod}`;
        }
    }
    if (commissionEl) commissionEl.textContent = `-€${commission}`;
    if (earningsEl) earningsEl.textContent = `€${earnings}`;
}

// =============================================
// CART SYSTEM
// =============================================

function addToCart(id) {
    const agent = agents.find(a => a.id === id);
    if (!agent) return;

    // Check if already in cart
    if (cart.find(item => item.id === id)) {
        showToast(`${agent.name} est déjà dans votre panier.`, 'info');
        return;
    }

    cart.push({
        id: agent.id,
        name: agent.name,
        price: agent.price,
        pricePeriod: agent.pricePeriod,
        icon: agent.icon,
        imageUrl: agent.imageUrl || null,
        bgColor: agent.bgColor,
        seller: agent.seller
    });

    updateCartUI();
    showToast(`${agent.name} ajouté au panier !`, 'success');
}

function removeFromCart(id) {
    cart = cart.filter(item => item.id !== id);
    updateCartUI();
}

function clearCart() {
    cart = [];
    updateCartUI();
    showToast('Panier vidé.', 'info');
}

function updateCartUI() {
    const count = cart.length;

    // Badge
    cartBadge.textContent = count;
    if (count === 0) {
        cartBadge.classList.add('empty');
    } else {
        cartBadge.classList.remove('empty');
    }

    // Pulse animation
    cartBadge.classList.remove('pulse');
    void cartBadge.offsetWidth; // reflow
    cartBadge.classList.add('pulse');

    // Cart items
    if (count === 0) {
        cartItemsEl.innerHTML = `
            <div class="cart-empty">
                <i class="fas fa-shopping-basket"></i>
                <p>Votre panier est vide</p>
            </div>
        `;
        cartFooter.style.display = 'none';
    } else {
        cartItemsEl.innerHTML = cart.map(item => {
            const iconContent = item.imageUrl
                ? `<img src="${item.imageUrl}" alt="${item.name}">`
                : item.icon;
            return `
            <div class="cart-item">
                <div class="cart-item-icon" style="background: ${item.bgColor}">${iconContent}</div>
                <div class="cart-item-info">
                    <div class="cart-item-name">${item.name}</div>
                    <div class="cart-item-seller">par ${item.seller}</div>
                </div>
                <div class="cart-item-price">€${item.price}<span style="font-size:11px;font-weight:400;color:#94a3b8;">${item.pricePeriod}</span></div>
                <button class="cart-item-remove" onclick="removeFromCart(${item.id})"><i class="fas fa-times"></i></button>
            </div>
        `}).join('');

        const total = cart.reduce((sum, item) => sum + item.price, 0);
        cartTotalEl.textContent = `€${total}`;
        cartFooter.style.display = 'block';
    }
}

function toggleCartDropdown() {
    cartDropdown.classList.toggle('hidden');
}

// =============================================
// ACTIONS
// =============================================

function handleBuy(id) {
    closeModal(agentModal);
    if (!isLoggedIn) {
        showToast('Connectez-vous pour ajouter au panier.', 'error');
        btnLogin.click();
        return;
    }
    addToCart(id);
}

function handleDemo(id) {
    const agent = agents.find(a => a.id === id);
    closeModal(agentModal);
    showToast(`Démo de ${agent.name} lancée !`, 'info');
}

// =============================================
// EVENT LISTENERS
// =============================================

// Filter tabs
filterTabs.forEach(tab => {
    tab.addEventListener('click', () => {
        filterTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentFilter = tab.dataset.filter;
        visibleCount = 6;
        renderAgents();
    });
});

// Sort
sortSelect.addEventListener('change', renderAgents);

// Search
let searchTimeout;
heroSearch.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        visibleCount = 12;
        renderAgents();
    }, 300);
});

// Search button
document.querySelector('.btn-search').addEventListener('click', () => {
    visibleCount = 12;
    renderAgents();
    document.getElementById('marketplace').scrollIntoView({ behavior: 'smooth' });
});

// Search tags
searchTags.forEach(tag => {
    tag.addEventListener('click', () => {
        heroSearch.value = tag.dataset.search;
        visibleCount = 12;
        renderAgents();
        document.getElementById('marketplace').scrollIntoView({ behavior: 'smooth' });
    });
});

// Category cards
categoryCards.forEach(card => {
    card.addEventListener('click', () => {
        const cat = card.dataset.category;
        heroSearch.value = '';
        currentFilter = cat;
        visibleCount = 12;

        filterTabs.forEach(t => {
            t.classList.remove('active');
            if (t.dataset.filter === cat) t.classList.add('active');
        });

        renderAgents();
        document.getElementById('marketplace').scrollIntoView({ behavior: 'smooth' });
    });
});

// Load more
loadMoreBtn.addEventListener('click', () => {
    visibleCount += ITEMS_PER_LOAD;
    renderAgents();
});

// Modal close
modalClose.addEventListener('click', () => closeModal(agentModal));
agentModal.addEventListener('click', (e) => {
    if (e.target === agentModal) closeModal(agentModal);
});

authModalClose.addEventListener('click', () => closeModal(authModal));
authModal.addEventListener('click', (e) => {
    if (e.target === authModal) closeModal(authModal);
});

sellModalClose.addEventListener('click', () => closeModal(sellModal));
sellModal.addEventListener('click', (e) => {
    if (e.target === sellModal) closeModal(sellModal);
});

// Auth buttons — simple login/signup (for buyers or generic)
btnLogin.addEventListener('click', () => {
    document.getElementById('authTitle').textContent = 'Connexion';
    document.getElementById('authSubtitle').textContent = 'Connectez-vous pour accéder à votre compte';
    document.getElementById('authSwitch').innerHTML = 'Pas encore de compte ? <a href="#">S\'inscrire</a>';
    authModal.classList.add('active');
    document.body.style.overflow = 'hidden';
});

btnSignup.addEventListener('click', () => {
    document.getElementById('authTitle').textContent = 'Créer un compte';
    document.getElementById('authSubtitle').textContent = 'Rejoignez la communauté AgentVerse';
    document.getElementById('authSwitch').innerHTML = 'Déjà un compte ? <a href="#">Se connecter</a>';
    authModal.classList.add('active');
    document.body.style.overflow = 'hidden';
});

// Auth form submit (generic login)
document.getElementById('authSubmitBtn').addEventListener('click', (e) => {
    e.preventDefault();
    const emailInput = authModal.querySelector('input[type="email"]');
    const email = emailInput ? emailInput.value.trim() : '';
    closeModal(authModal);
    loginUser(email.split('@')[0] || 'Utilisateur', email || 'user@email.com', '');
});

// Google auth buttons — wired via initGoogleSignIn() below

// Hamburger menu
hamburger.addEventListener('click', () => {
    navLinks.classList.toggle('active');
});

// Scroll navbar effect
window.addEventListener('scroll', () => {
    if (window.scrollY > 20) {
        navbar.classList.add('scrolled');
    } else {
        navbar.classList.remove('scrolled');
    }
});

// Close nav on link click (mobile)
navLinks.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
        navLinks.classList.remove('active');
    });
});

// Newsletter
document.getElementById('btnNewsletter').addEventListener('click', () => {
    const email = document.getElementById('emailInput').value;
    if (email && email.includes('@')) {
        showToast('Inscription réussie ! Bienvenue dans la communauté.', 'success');
        document.getElementById('emailInput').value = '';
    } else {
        showToast('Veuillez entrer une adresse email valide.', 'error');
    }
});

// =============================================
// SELL FLOW — Button triggers
// =============================================

// "Commencer à vendre" button (CTA section)
document.getElementById('btnStartSelling').addEventListener('click', () => {
    openSellModal();
});

// "Vendre un agent" button (navbar, logged in)
document.getElementById('btnNavSell').addEventListener('click', () => {
    openSellModal();
});

// Nav user avatar -> logout on click
document.getElementById('navUserAvatar').addEventListener('click', () => {
    if (confirm('Voulez-vous vous déconnecter ?')) {
        logoutUser();
    }
});

// "Vendre" link in nav
document.querySelectorAll('.nav-links a').forEach(link => {
    if (link.getAttribute('href') === '#sell') {
        link.addEventListener('click', (e) => {
            // If user clicks "Vendre" in nav, also allow opening sell modal
            // We let the default scroll behavior happen, no extra action needed here
        });
    }
});

// =============================================
// SELL FLOW — Step Navigation
// =============================================

// Step 1 -> Step 2
document.getElementById('sellNext1').addEventListener('click', () => {
    if (validateSellStep1()) {
        sellStep = 2;
        updateSellStep();
    }
});

// Step 2 -> Step 1
document.getElementById('sellBack2').addEventListener('click', () => {
    // If was already logged in, can't go back to step 1
    if (!isLoggedIn) {
        sellStep = 1;
    }
    updateSellStep();
});

// Step 2 -> Step 3
document.getElementById('sellNext2').addEventListener('click', () => {
    if (validateSellStep2()) {
        sellStep = 3;
        updateSellStep();
        updatePricingSummary();
    }
});

// Step 3 -> Step 2
document.getElementById('sellBack3').addEventListener('click', () => {
    sellStep = 2;
    updateSellStep();
});

// Step 3 -> Step 4
document.getElementById('sellNext3').addEventListener('click', () => {
    if (validateSellStep3()) {
        sellStep = 4;
        updateSellStep();
    }
});

// Step 4 -> Step 3
document.getElementById('sellBack4').addEventListener('click', () => {
    sellStep = 3;
    updateSellStep();
});

// Publish!
document.getElementById('sellPublish').addEventListener('click', () => {
    publishAgent();
});

// =============================================
// SELL FORM — Interactive elements
// =============================================

// Emoji picker
document.querySelectorAll('.emoji-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.emoji-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selectedEmoji = btn.dataset.emoji;
    });
});

// Pricing model radio buttons
document.querySelectorAll('.pricing-option').forEach(option => {
    option.addEventListener('click', () => {
        document.querySelectorAll('.pricing-option').forEach(o => o.classList.remove('selected'));
        option.classList.add('selected');
        selectedPricingModel = option.dataset.pricing;
        updatePricingSummary();
    });
});

// Short description character counter
const shortDescInput = document.getElementById('agentShortDesc');
if (shortDescInput) {
    shortDescInput.addEventListener('input', () => {
        const count = shortDescInput.value.length;
        document.getElementById('shortDescCount').textContent = count;
    });
}

// Price and discount -> update summary
const priceInput = document.getElementById('agentPrice');
const discountInput = document.getElementById('agentDiscount');
if (priceInput) priceInput.addEventListener('input', updatePricingSummary);
if (discountInput) discountInput.addEventListener('input', updatePricingSummary);

// =============================================
// CUSTOM CATEGORY — Show/hide input
// =============================================

const agentCategorySelect = document.getElementById('agentCategory');
const customCategoryWrapper = document.getElementById('customCategoryWrapper');
const cancelCustomCategory = document.getElementById('cancelCustomCategory');

agentCategorySelect.addEventListener('change', () => {
    if (agentCategorySelect.value === '__custom__') {
        customCategoryWrapper.classList.remove('hidden');
        document.getElementById('customCategoryName').focus();
    } else {
        customCategoryWrapper.classList.add('hidden');
        document.getElementById('customCategoryName').value = '';
    }
});

cancelCustomCategory.addEventListener('click', () => {
    agentCategorySelect.value = '';
    customCategoryWrapper.classList.add('hidden');
    document.getElementById('customCategoryName').value = '';
});

// =============================================
// ICON MODE — Emoji / Upload toggle
// =============================================

document.querySelectorAll('.icon-mode-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.icon-mode-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const mode = tab.dataset.mode;
        iconMode = mode;

        const emojiContent = document.getElementById('iconModeEmoji');
        const uploadContent = document.getElementById('iconModeUpload');

        if (mode === 'emoji') {
            emojiContent.classList.remove('hidden');
            uploadContent.classList.add('hidden');
        } else {
            emojiContent.classList.add('hidden');
            uploadContent.classList.remove('hidden');
        }
    });
});

// =============================================
// IMAGE UPLOAD — Click, drag & drop, preview
// =============================================

const uploadZone = document.getElementById('uploadZone');
const agentImageInput = document.getElementById('agentImageInput');
const uploadPlaceholder = document.getElementById('uploadPlaceholder');
const uploadPreview = document.getElementById('uploadPreview');
const uploadPreviewImg = document.getElementById('uploadPreviewImg');
const uploadRemove = document.getElementById('uploadRemove');

// Click to open file picker
uploadZone.addEventListener('click', (e) => {
    // Don't trigger if clicking the remove button
    if (e.target.closest('.upload-remove')) return;
    agentImageInput.click();
});

// File selected
agentImageInput.addEventListener('change', () => {
    const file = agentImageInput.files[0];
    if (file) handleImageFile(file);
});

// Drag & drop
uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('dragover');
});

uploadZone.addEventListener('dragleave', () => {
    uploadZone.classList.remove('dragover');
});

uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
        handleImageFile(file);
    } else {
        showToast('Veuillez déposer un fichier image (PNG, JPG, SVG).', 'error');
    }
});

function handleImageFile(file) {
    // Max 2 Mo
    if (file.size > 2 * 1024 * 1024) {
        showToast('L\'image est trop volumineuse (max 2 Mo).', 'error');
        return;
    }
    if (!file.type.startsWith('image/')) {
        showToast('Le fichier doit être une image (PNG, JPG, SVG).', 'error');
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        uploadedImageDataUrl = e.target.result;
        uploadPreviewImg.src = uploadedImageDataUrl;
        uploadPlaceholder.classList.add('hidden');
        uploadPreview.classList.remove('hidden');
        showToast('Image chargée avec succès !', 'success');
    };
    reader.readAsDataURL(file);
}

// Remove uploaded image
uploadRemove.addEventListener('click', (e) => {
    e.stopPropagation();
    uploadedImageDataUrl = null;
    agentImageInput.value = '';
    uploadPlaceholder.classList.remove('hidden');
    uploadPreview.classList.add('hidden');
    uploadPreviewImg.src = '';
});

// =============================================
// CART — Event listeners
// =============================================

navCartBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleCartDropdown();
});

// Close cart dropdown when clicking outside
document.addEventListener('click', (e) => {
    if (!cartDropdown.classList.contains('hidden') &&
        !cartDropdown.contains(e.target) &&
        !navCartBtn.contains(e.target)) {
        cartDropdown.classList.add('hidden');
    }
});

cartClearAll.addEventListener('click', () => {
    clearCart();
});

cartCheckout.addEventListener('click', () => {
    cartDropdown.classList.add('hidden');
    openCheckoutModal();
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeModal(agentModal);
        closeModal(authModal);
        closeModal(sellModal);
        closeModal(checkoutModalEl);
        cartDropdown.classList.add('hidden');
    }
});

// =============================================
// SCROLL REVEAL (Intersection Observer)
// =============================================

const revealElements = document.querySelectorAll(
    '.category-card, .step, .testimonial-card, .sell-cta-content, .section-header'
);

const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.style.opacity = '1';
            entry.target.style.transform = 'translateY(0)';
            revealObserver.unobserve(entry.target);
        }
    });
}, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

revealElements.forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(30px)';
    el.style.transition = 'all 0.6s cubic-bezier(0.4, 0, 0.2, 1)';
    revealObserver.observe(el);
});

// =============================================
// GOOGLE SIGN-IN (Identity Services)
// =============================================

// Decode JWT payload (base64url) without external lib
function decodeJwtPayload(token) {
    try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(
            atob(base64).split('').map(c =>
                '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
            ).join('')
        );
        return JSON.parse(jsonPayload);
    } catch (e) {
        console.error('Erreur décodage JWT:', e);
        return null;
    }
}

function isGoogleConfigured() {
    return typeof CONFIG !== 'undefined' &&
           CONFIG.GOOGLE_CLIENT_ID &&
           CONFIG.GOOGLE_CLIENT_ID !== 'VOTRE_GOOGLE_CLIENT_ID_ICI';
}

function handleGoogleSignIn(response) {
    const payload = decodeJwtPayload(response.credential);
    if (!payload) {
        showToast('Erreur lors de la connexion Google.', 'error');
        return;
    }

    const fullName = payload.name || 'Utilisateur Google';
    const email = payload.email || '';
    const picture = payload.picture || '';

    // Close any open modal
    closeModal(authModal);
    closeModal(sellModal);

    // Login
    loginUser(fullName, email, '');

    // Store picture if available
    if (picture && currentUser) {
        currentUser.picture = picture;
    }
}

function triggerGoogleSignIn() {
    if (!isGoogleConfigured()) {
        showToast('Google Sign-In : configurez votre Client ID dans config.js (voir instructions).', 'error');
        return;
    }

    // Use the Google One Tap / popup
    if (typeof google !== 'undefined' && google.accounts) {
        google.accounts.id.prompt((notification) => {
            if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
                // Fallback: try popup mode
                showToast('Popup Google bloquée. Autorisez les popups pour ce site.', 'info');
            }
        });
    } else {
        showToast('Google Identity Services non chargé. Vérifiez votre connexion internet.', 'error');
    }
}

function initGoogleSignIn() {
    if (!isGoogleConfigured()) {
        console.log('ℹ️ Google Sign-In non configuré. Remplacez GOOGLE_CLIENT_ID dans config.js.');
        return;
    }

    if (typeof google === 'undefined' || !google.accounts) {
        // GIS not loaded yet, retry
        setTimeout(initGoogleSignIn, 500);
        return;
    }

    google.accounts.id.initialize({
        client_id: CONFIG.GOOGLE_CLIENT_ID,
        callback: handleGoogleSignIn,
        auto_select: false,
        cancel_on_tap_outside: true,
    });

    console.log('✅ Google Sign-In initialisé.');
}

// Google buttons event listeners
document.getElementById('googleAuthBtn').addEventListener('click', (e) => {
    e.preventDefault();
    triggerGoogleSignIn();
});

document.getElementById('googleSellBtn').addEventListener('click', (e) => {
    e.preventDefault();
    triggerGoogleSignIn();
});

// =============================================
// STRIPE CHECKOUT
// =============================================

const checkoutModalEl = document.getElementById('checkoutModal');
const checkoutModalClose = document.getElementById('checkoutModalClose');
const stripePayBtn = document.getElementById('stripePayBtn');

// Close checkout modal
checkoutModalClose.addEventListener('click', () => closeModal(checkoutModalEl));
checkoutModalEl.addEventListener('click', (e) => {
    if (e.target === checkoutModalEl) closeModal(checkoutModalEl);
});

function isStripeConfigured() {
    return typeof CONFIG !== 'undefined' &&
           CONFIG.STRIPE_PUBLISHABLE_KEY &&
           CONFIG.STRIPE_PUBLISHABLE_KEY !== 'VOTRE_STRIPE_PUBLISHABLE_KEY_ICI';
}

function openCheckoutModal() {
    if (cart.length === 0) {
        showToast('Votre panier est vide.', 'error');
        return;
    }

    const checkoutItemsEl = document.getElementById('checkoutItems');
    const checkoutSubtotal = document.getElementById('checkoutSubtotal');
    const checkoutTva = document.getElementById('checkoutTva');
    const checkoutTotalEl = document.getElementById('checkoutTotal');
    const stripePayAmount = document.getElementById('stripePayAmount');

    // Render items
    checkoutItemsEl.innerHTML = cart.map(item => {
        const iconContent = item.imageUrl
            ? `<img src="${item.imageUrl}" alt="${item.name}">`
            : item.icon;
        return `
            <div class="checkout-item">
                <div class="checkout-item-icon" style="background: ${item.bgColor}">${iconContent}</div>
                <div class="checkout-item-info">
                    <div class="checkout-item-name">${item.name}</div>
                    <div class="checkout-item-seller">par ${item.seller}</div>
                </div>
                <div class="checkout-item-price">€${item.price}${item.pricePeriod}</div>
            </div>
        `;
    }).join('');

    // Calculate totals
    const subtotal = cart.reduce((sum, item) => sum + item.price, 0);
    const tva = Math.round(subtotal * 0.20 * 100) / 100;
    const total = Math.round((subtotal + tva) * 100) / 100;

    checkoutSubtotal.textContent = `€${subtotal.toFixed(2)}`;
    checkoutTva.textContent = `€${tva.toFixed(2)}`;
    checkoutTotalEl.textContent = `€${total.toFixed(2)}`;
    stripePayAmount.textContent = `€${total.toFixed(2)}`;

    checkoutModalEl.classList.add('active');
    document.body.style.overflow = 'hidden';
}

stripePayBtn.addEventListener('click', () => {
    if (cart.length === 0) return;

    const subtotal = cart.reduce((sum, item) => sum + item.price, 0);
    const tva = Math.round(subtotal * 0.20 * 100) / 100;
    const total = Math.round((subtotal + tva) * 100) / 100;

    // Visual loading state
    stripePayBtn.classList.add('loading');
    stripePayBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> <span>Traitement en cours...</span>';

    if (isStripeConfigured()) {
        // --- REAL STRIPE CHECKOUT ---
        try {
            const stripe = Stripe(CONFIG.STRIPE_PUBLISHABLE_KEY);

            // Build line items for Stripe Checkout
            // Note: In production, the checkout session should be created
            // server-side. Client-only mode uses price IDs from Stripe Dashboard.
            // Here we use client-only redirect with dynamic amounts.

            const lineItems = cart.map(item => ({
                price_data: {
                    currency: 'eur',
                    product_data: {
                        name: item.name,
                        description: `Agent IA par ${item.seller}`,
                    },
                    unit_amount: Math.round((item.price * 1.20) * 100), // TTC in cents
                    recurring: item.pricePeriod === '/mois' ? { interval: 'month' } : undefined,
                },
                quantity: 1,
            }));

            // For client-only mode, we redirect to Stripe Checkout.
            // This requires pre-created Price IDs in Stripe Dashboard.
            // As a fallback for demo, we'll try redirectToCheckout:
            stripe.redirectToCheckout({
                lineItems: cart.map(item => ({
                    price: item.stripePriceId || 'price_demo', // needs real price IDs
                    quantity: 1,
                })),
                mode: cart.some(i => i.pricePeriod === '/mois') ? 'subscription' : 'payment',
                successUrl: window.location.href + '?payment=success',
                cancelUrl: window.location.href + '?payment=cancel',
            }).then(result => {
                if (result.error) {
                    // If redirect fails (e.g. no valid price IDs), use fallback
                    console.warn('Stripe redirect error:', result.error.message);
                    stripePaymentFallback(total);
                }
            });
        } catch (err) {
            console.error('Stripe error:', err);
            stripePaymentFallback(total);
        }
    } else {
        // --- DEMO MODE (no Stripe key configured) ---
        console.log('ℹ️ Stripe non configuré — mode démo activé.');
        stripePaymentFallback(total);
    }
});

function stripePaymentFallback(total) {
    // Simulated payment for demo mode
    setTimeout(() => {
        stripePayBtn.classList.remove('loading');
        stripePayBtn.innerHTML = '<i class="fas fa-credit-card"></i> <span>Payer <strong>€' + total.toFixed(2) + '</strong></span>';

        closeModal(checkoutModalEl);
        showToast('Paiement de €' + total.toFixed(2) + ' effectué avec succès !', 'success');

        if (!isStripeConfigured()) {
            setTimeout(() => {
                showToast('Mode démo : configurez Stripe dans config.js pour les vrais paiements.', 'info');
            }, 1500);
        }

        clearCart();
    }, 2000);
}

// Handle Stripe return URLs
(function checkPaymentReturn() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('payment') === 'success') {
        showToast('Paiement confirmé ! Merci pour votre achat.', 'success');
        clearCart();
        // Clean URL
        window.history.replaceState({}, '', window.location.pathname);
    } else if (params.get('payment') === 'cancel') {
        showToast('Paiement annulé.', 'info');
        window.history.replaceState({}, '', window.location.pathname);
    }
})();

// =============================================
// INIT
// =============================================

renderAgents();

// Initialize Google Sign-In (with delay to let GIS script load)
setTimeout(initGoogleSignIn, 300);

console.log('🚀 AgentVerse — Marketplace d\'Agents IA chargée avec succès !');
