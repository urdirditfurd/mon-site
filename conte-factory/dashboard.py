"""Accueil video ia — hub simple Suivi + Creation."""

from __future__ import annotations

import sys
from pathlib import Path

import streamlit as st

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from ui_helpers import boot_app, go_page, nav_buttons, render_engine_status, render_sidebar

ctx = boot_app("video ia")
render_sidebar("Accueil")
nav_buttons("Accueil")

st.markdown(
    f"""
<div class="hero-card">
  <div class="section-label">Contes du Soir</div>
  <h1 style="margin:0 0 8px 0;">video ia</h1>
  <p>Cree une video a partir d'un theme, suis l'avancement, publie sur YouTube.</p>
  <span class="badge-soft">{ctx['channel']}</span>
</div>
""",
    unsafe_allow_html=True,
)

render_engine_status(ctx, "home")

a, b = st.columns(2)
with a:
    st.markdown(
        """
<div class="hero-card">
  <h3>Suivi</h3>
  <p>Videos creees, statut, lecture, publication YouTube.</p>
</div>
""",
        unsafe_allow_html=True,
    )
    if st.button("Ouvrir Suivi", type="primary", use_container_width=True):
        go_page("pages/1_Tableau_de_bord.py")
    st.markdown(
        '<a class="nav-pill" href="/Tableau_de_bord" target="_blank">Nouvel onglet</a>',
        unsafe_allow_html=True,
    )
with b:
    st.markdown(
        """
<div class="hero-card">
  <h3>Creation</h3>
  <p>Theme, duree, voix, sous-titres, barre de progression.</p>
</div>
""",
        unsafe_allow_html=True,
    )
    if st.button("Ouvrir Creation", type="primary", use_container_width=True):
        go_page("pages/2_Creation.py")
    st.markdown(
        '<a class="nav-pill" href="/Creation" target="_blank">Nouvel onglet</a>',
        unsafe_allow_html=True,
    )

if not ctx["wan_ok"] and ctx["uses_wan"]:
    st.info("Le moteur video demarre en arriere-plan. Tu peux deja preparer ta creation.")
