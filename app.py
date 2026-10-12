"""
Loan Explorer Dashboard (Streamlit + Plotly)

Run locally:
    pip install -r requirements.txt
    streamlit run app.py
"""

from pathlib import Path

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

BLUE = "#6A9CC9"
GRAY = "#D3D3D3"
DARK_GRAY = "#666666"
DATA_PATH = Path(__file__).parent / "loan_dataset.csv"  # relative: no personal paths

st.set_page_config(page_title="Loan Explorer Dashboard", layout="wide")


# ----------------------------------------------------------------------------
# Data
# ----------------------------------------------------------------------------
@st.cache_data
def load_data() -> pd.DataFrame:
    df = pd.read_csv(DATA_PATH)
    df["score_bin"] = (df["credit_score"] // 50) * 50
    return df


df = load_data()

# ----------------------------------------------------------------------------
# Sidebar filters
# ----------------------------------------------------------------------------
st.sidebar.header("Filters")

terms = st.sidebar.multiselect(
    "Loan term (months)", sorted(df["loan_term"].unique()), default=sorted(df["loan_term"].unique())
)
purposes = st.sidebar.multiselect(
    "Loan purpose", sorted(df["loan_purpose"].unique()), default=sorted(df["loan_purpose"].unique())
)
employment = st.sidebar.multiselect(
    "Employment status", sorted(df["employment_status"].unique()),
    default=sorted(df["employment_status"].unique()),
)
score_min, score_max = int(df["credit_score"].min()), int(df["credit_score"].max())
score_range = st.sidebar.slider("Credit score range", score_min, score_max, (score_min, score_max))

d = df[
    df["loan_term"].isin(terms)
    & df["loan_purpose"].isin(purposes)
    & df["employment_status"].isin(employment)
    & df["credit_score"].between(*score_range)
]

# ----------------------------------------------------------------------------
# Header + KPIs
# ----------------------------------------------------------------------------
st.title("Loan Explorer Dashboard")
st.caption("How do credit score, loan term and purpose affect interest rates?")

if d.empty:
    st.warning("No borrowers match these filters. Try widening them.")
    st.stop()

c1, c2, c3, c4 = st.columns(4)
c1.metric("Borrowers", f"{len(d):,}")
c2.metric("Avg interest rate", f"{d['interest_rate'].mean():.2f}%")
c3.metric("Avg loan amount", f"${d['loan_amount'].mean():,.0f}")
c4.metric("Paid back", f"{d['loan_paid_back'].mean() * 100:.1f}%")

# ----------------------------------------------------------------------------
# Chart 1: premium vs. bucket average (recreated Tableau chart)
# ----------------------------------------------------------------------------
by_term = d.groupby(["score_bin", "loan_term"])["interest_rate"].agg(["mean", "count"])
avg_rate = by_term["mean"].unstack("loan_term")
counts = by_term["count"].unstack("loan_term")
premium = avg_rate.sub(d.groupby("score_bin")["interest_rate"].mean(), axis=0)

fig1 = go.Figure()
for term, color in [(60, GRAY), (36, BLUE)]:  # 36 drawn last so it sits on top
    if term not in premium.columns:
        continue
    fig1.add_trace(go.Scatter(
        x=premium.index, y=premium[term], mode="markers", name=f"{term}-month",
        marker=dict(size=26, color=color),
        customdata=counts[term],
        hovertemplate=f"<b>{term}-month</b><br>Score bucket: %{{x}}<br>"
                      "Premium: %{y:+.2f} pts<br>Borrowers: %{customdata:,}<extra></extra>",
    ))
fig1.add_hline(y=0, line=dict(color="#CCCCCC", width=1))
fig1.update_layout(
    title="Interest premium vs. bucket average (above 0 = pays more than average)",
    xaxis=dict(title="Credit score (50-pt buckets)", tickvals=list(premium.index), showgrid=False),
    yaxis=dict(title="Premium (percentage points)", showgrid=False, zeroline=False),
    template="plotly_white", height=430, legend=dict(orientation="h", y=-0.2),
)
st.plotly_chart(fig1, width="stretch")

# ----------------------------------------------------------------------------
# Chart 2 + 3
# ----------------------------------------------------------------------------
left, right = st.columns(2)

fig2 = go.Figure()
for term, color in [(36, BLUE), (60, "#AAAAAA")]:
    if term in avg_rate.columns:
        fig2.add_trace(go.Scatter(
            x=avg_rate.index, y=avg_rate[term], mode="lines+markers", name=f"{term}-month",
            line=dict(color=color, width=3),
            hovertemplate=f"{term}-month<br>Bucket %{{x}}: %{{y:.2f}}%<extra></extra>",
        ))
fig2.update_layout(
    title="Average interest rate by credit score",
    xaxis=dict(title="Credit score bucket", tickvals=list(avg_rate.index), showgrid=False),
    yaxis=dict(title="Avg interest rate (%)"),
    template="plotly_white", height=380, legend=dict(orientation="h", y=-0.25),
)
left.plotly_chart(fig2, width="stretch")

purpose = (
    d.groupby("loan_purpose")["interest_rate"].agg(["mean", "count"]).sort_values("mean")
)
fig3 = go.Figure(go.Bar(
    x=purpose["mean"], y=purpose.index, orientation="h", marker_color=BLUE,
    customdata=purpose["count"],
    hovertemplate="%{y}<br>Avg rate: %{x:.2f}%<br>Borrowers: %{customdata:,}<extra></extra>",
))
fig3.update_layout(
    title="Average interest rate by loan purpose",
    xaxis=dict(title="Avg interest rate (%)"), template="plotly_white", height=380,
    margin=dict(l=130),
)
right.plotly_chart(fig3, width="stretch")

st.caption(
    "Data Source: Loan Predictions 2025, Kaggle. Premium = average rate for a loan term minus the "
    "average rate of all filtered borrowers in the same 50-point credit score bucket."
)
