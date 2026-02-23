const { connect, getSequelize } = require('./api/db/sequelize');

async function test() {
  console.log('Conectando ao banco...');
  await connect();
  
  const sequelize = getSequelize();
  console.log('Sequelize conectado:', !!sequelize);
  
  // Chamar defineRelationships para inicializar todos os modelos
  const { defineRelationships } = require('./api/db/models/index');
  console.log('\nInicializando modelos via defineRelationships()...');
  defineRelationships();
  
  // Listar todos os modelos CRM
  const crmModels = Object.keys(sequelize.models).filter(m => m.startsWith('Crm'));
  console.log('\n✅ Modelos CRM registrados:', crmModels.length);
  console.log(crmModels.sort().join(', '));
  
  // Verificar se os modelos RBAC estão presentes
  const rbacModels = ['CrmRole', 'CrmUserRole', 'CrmResourcePermission', 'CrmAuditLog'];
  const missing = rbacModels.filter(m => !sequelize.models[m]);
  
  if (missing.length > 0) {
    console.log('\n❌ Modelos RBAC faltando:', missing.join(', '));
  } else {
    console.log('\n✅ Todos os modelos RBAC estão presentes!');
  }
  
  process.exit(0);
}

test().catch(err => {
  console.error('❌ Erro:', err.message);
  console.error(err.stack);
  process.exit(1);
});
