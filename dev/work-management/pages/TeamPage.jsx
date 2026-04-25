import React from 'react';

export function TeamPage({ model }) {
  return (
    <section className="wm-panel">
      <div className="wm-panel-header">
        <h2>Team</h2>
        <span>owner, contributors, reviewers, operators</span>
      </div>
      <div className="wm-card-grid">
        {model.team.map((member) => (
          <article key={member.id} className="wm-team-card">
            <h3>{member.name}</h3>
            <p>{member.role}</p>
            <div className="wm-inline-meta">
              <span>Carga {member.workload}/10</span>
              <span>Aprovacoes {member.approvalsPending}</span>
              <span>Itens {member.activeItems}</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export default TeamPage;