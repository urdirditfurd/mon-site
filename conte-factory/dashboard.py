"""Accueil video ia — hub vers 2 fenetres (violet / gris clair)."""

from __future__ import annotations

import sys
from pathlib import Path

import streamlit as st

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from ui_helpers import boot_app, go_page, nav_buttons, render_sidebar, render_wan_bar

ctx = boot_app("video ia — Accueil")
render_sidebar("Accueil")
nav_buttons("Accueil")

st.markdown(
    f"""
<div class="hero-card">
  <div class="section-label">Contes du Soir</div>
  <h1 style="margin:0 0 8px 0;">video ia</h1>
  <p>Creation automatique : histoire → Wan → montage → YouTube</p>
  <span class="badge-soft">{ctx['channel']}</span>
</div>
""",
    unsafe_allow_html=True,
)

render_wan_bar(ctx, key_prefix="home")

st.markdown("### Deux fenetres a ouvrir")
a, b = st.columns(2)
with a:
    st.markdown(
        """
<div class="hero-card">
  <h3>1. Tableau de bord</h3>
  <p>Suivi des videos, publication YouTube, bouton de creation. Ideal le matin.</p>
</div>
""",
        unsafe_allow_html=True,
    )
    if st.button("Ouvrir Tableau de bord", type="primary", use_container_width=True):
        go_page("pages/1_Tableau_de_bord.py")
    st.markdown(
        '<a class="nav-pill" href="/Tableau_de_bord" target="_blank">Nouvel onglet →</a>',
        unsafe_allow_html=True,
    )
with b:
    st.markdown(
        """
<div class="hero-card">
  <h3>2. Technique</h3>
  <p>Historique, script, audio, clips Wan, montage, durees, journal d'erreurs.</p>
</div>
""",
        unsafe_allow_html=True,
    )
    if st.button("Ouvrir Technique", type="primary", use_container_width=True):
        go_page("pages/2_Technique.py")
    st.markdown(
        '<a class="nav-pill" href="/Technique" target="_blank">Nouvel onglet →</a>',
        unsafe_allow_html=True,
    )

st.info(
    "Astuce : ouvre les deux liens « Nouvel onglet » pour avoir **2 fenetres** "
    "cote a cote (suivi + technique)."
)

if not ctx["wan_ok"] and ctx["uses_wan"]:
    st.warning("Wan hors ligne — demarre-le avant de creer une video.")
