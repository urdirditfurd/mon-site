"""Page d'accueil — lance les 2 fenetres du site video ia."""

from __future__ import annotations

import sys
from pathlib import Path

import streamlit as st

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from ui_helpers import boot_app, render_sidebar, render_wan_bar

ctx = boot_app()
render_sidebar("Accueil")

st.title(f"video ia — {ctx['channel']}")
st.caption("Creation automatique : histoire → Wan → montage → YouTube")
render_wan_bar(ctx)

st.markdown("## Choisis ta fenetre")
st.markdown(
    """
Ce site a **2 pages separees** (comme 2 fenetres).  
Clique ci-dessous — tu peux aussi ouvrir chaque lien dans un **nouvel onglet** (clic droit → Ouvrir).
"""
)

a, b = st.columns(2)
with a:
    st.markdown("### 1. Tableau de bord")
    st.write("Suivi des videos, publication YouTube, bouton de creation.")
    st.page_link("pages/1_Tableau_de_bord.py", label="Ouvrir le Tableau de bord", icon="📊")
    st.markdown("[Ouvrir dans un nouvel onglet](/Tableau_de_bord)")
with b:
    st.markdown("### 2. Technique")
    st.write("Historique, script, audio, clips, montage, durees, journal.")
    st.page_link("pages/2_Technique.py", label="Ouvrir Technique", icon="🔧")
    st.markdown("[Ouvrir dans un nouvel onglet](/Technique)")

st.divider()
st.info(
    "Astuce : garde le **Tableau de bord** ouvert le matin, "
    "et **Technique** dans un 2e onglet pour inspecter une video."
)

if not ctx["wan_ok"] and ctx["uses_wan"]:
    st.warning("Wan hors ligne — demarre-le avant de creer une video.")
