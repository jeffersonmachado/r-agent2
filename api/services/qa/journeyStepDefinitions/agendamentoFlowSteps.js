'use strict';

/**
 * agendamentoFlowSteps.js
 *
 * Definições de steps Playwright reais para a jornada `agendamento`
 * (vertical fitness — matrícula/agendamento de aula experimental via UI real).
 *
 * Cada step possui:
 *   - id, actionType, selectorUsed: metadados de auditoria
 *   - execute(page): função assíncrona que executa ação real na UI
 *   - mutation proof nasce no executor após afterStepSnapshot + incrementalDiff
 *
 * Jornada (6 steps canônicos do operationalStepRegistry):
 *   1. step_agendamento_access_workspace  → navigate          (SEM mutação)
 *   2. step_agendamento_open_builder      → click_open        (SEM mutação)
 *   3. step_agendamento_open_tasks        → click_open        (SEM mutação)
 *   4. step_agendamento_create_task       → create_task       (MUTAÇÃO: task_created → POST /api/tasks)
 *   5. step_agendamento_open_schedule     → click_open        (SEM mutação)
 *   6. step_agendamento_confirm_schedule  → assert_ui_state   (confirma toast "Agendamento criado")
 *
 * NOTA: a ÚNICA mutação persistente em banco é a criação da tarefa
 * (POST /api/tasks → tabela `tasks`, tenant_id-based). O agendamento em si é
 * gravado no scheduleService (em memória) — o toast "Agendamento criado" é a
 * prova de UI da conclusão da jornada, mas não gera snapshot de banco.
 * O contrato de estado exige apenas db.task.count:incremented.
 */

const JOURNEY_ID = 'agendamento';
const WORKSPACE_PATH = '/workspace';
const { assertOperationalCondition } = require('../operationalAssertions');
const { defaultFutureLocalDatetime } = require('../seeds/agendamentoOperationalSeed');

async function waitForRequiredSelector(page, selector, timeout, metadata = {}) {
  try {
    const element = await page.waitForSelector(selector, { timeout });
    assertOperationalCondition(Boolean(element), {
      reason: metadata.reason || 'agendamento_required_selector_missing',
      ...metadata,
      selector,
    });
    return element;
  } catch (error) {
    assertOperationalCondition(false, {
      reason: metadata.reason || 'agendamento_required_selector_missing',
      ...metadata,
      selector,
      error: error?.message || String(error),
    });
    return null;
  }
}

/**
 * Gera array de steps operacionais para a jornada `agendamento`.
 *
 * @param {object} seedData - dados provisionados pelo agendamentoOperationalSeed
 * @param {string} [seedData.baseUrl] - origem do frontend (UI real)
 * @param {string} [seedData.taskTitle] - título da tarefa a ser criada
 * @param {string} [seedData.taskDueDate] - prazo da tarefa (datetime-local)
 * @param {string} [seedData.scheduleStartAt] - data/hora inicial do agendamento
 * @param {string} [seedData.schedulePurpose] - finalidade do agendamento
 * @param {string} [seedData.scheduleNotes] - notas do agendamento
 * @returns {Array<object>} steps com execute(page)
 */
function buildAgendamentoFlowSteps(seedData = {}) {
  const {
    baseUrl = '',
    taskTitle = 'Aula experimental QA',
    taskDueDate = defaultFutureLocalDatetime(9),
    scheduleStartAt = defaultFutureLocalDatetime(10),
    schedulePurpose = 'aula experimental',
    scheduleNotes = 'Cliente interessado em pilates; confirmar unidade Paulista.',
  } = seedData;

  const builderRailSelector = 'a[aria-label="Construtor"]';
  const execSectionSelector = '.rap-secondary-nav-section-header:has-text("Execução")';
  const tasksItemSelector = '.rap-secondary-nav-item:has-text("Tarefas")';
  const taskFormSelector = '.support-details-panel:has-text("Nova tarefa")';
  const taskTitleInputSelector = `${taskFormSelector} input`;
  const taskDueInputSelector = `${taskFormSelector} input[type="datetime-local"]`;
  const createTaskButtonSelector = 'button:has-text("Criar tarefa")';
  const taskCreatedToastSelector = '.rap-toast--success:has-text("Tarefa criada")';
  const scheduleButtonSelector = `div.p-3:has-text("${taskTitle}") button:has-text("Agendar")`;
  const scheduleModalSelector = '.support-modal-content';
  const scheduleDateInputSelector = `${scheduleModalSelector} input[type="datetime-local"]`;
  const schedulePurposeInputSelector = 'input[placeholder="Buscar finalidade..."]';
  const scheduleNotesInputSelector = `${scheduleModalSelector} textarea.support-form-textarea`;
  const scheduleSubmitSelector = `${scheduleModalSelector} button[type="submit"]`;
  const scheduleCreatedToastSelector = '.rap-toast--success:has-text("Agendamento criado")';

  return [
    // ── Step 1: acesso ao workspace (login automático pousa aqui) ───────────
    {
      id: 'step_agendamento_access_workspace',
      actionType: 'navigate',
      selectorUsed: null,
      journeyId: JOURNEY_ID,
      async execute(page) {
        const target = `${baseUrl}${WORKSPACE_PATH}`;
        await page.goto(target, { waitUntil: 'domcontentloaded' });
        await waitForRequiredSelector(page, '.rap-primary-rail', 20000, {
          reason: 'agendamento_shell_missing',
          journeyId: JOURNEY_ID,
          target,
        });
      },
    },

    // ── Step 2: abrir rail Construtor ────────────────────────────────────────
    {
      id: 'step_agendamento_open_builder',
      actionType: 'open_builder_rail',
      selectorUsed: builderRailSelector,
      journeyId: JOURNEY_ID,
      async execute(page) {
        const element = await waitForRequiredSelector(page, builderRailSelector, 15000, {
          reason: 'agendamento_builder_rail_missing',
          journeyId: JOURNEY_ID,
        });
        await element.click();
      },
    },

    // ── Step 3: abrir Execução → Tarefas ─────────────────────────────────────
    {
      id: 'step_agendamento_open_tasks',
      actionType: 'open_tasks_module',
      selectorUsed: tasksItemSelector,
      journeyId: JOURNEY_ID,
      async execute(page) {
        await waitForRequiredSelector(page, execSectionSelector, 15000, {
          reason: 'agendamento_exec_section_missing',
          journeyId: JOURNEY_ID,
        }).then((el) => el && el.click());

        const tasksItem = await waitForRequiredSelector(page, tasksItemSelector, 15000, {
          reason: 'agendamento_tasks_item_missing',
          journeyId: JOURNEY_ID,
        });
        await tasksItem.click();

        await waitForRequiredSelector(page, '.support-details-title:has-text("Nova tarefa")', 20000, {
          reason: 'agendamento_task_form_missing',
          journeyId: JOURNEY_ID,
        });
      },
    },

    // ── Step 4: criar tarefa (MUTAÇÃO: POST /api/tasks → task_created) ──────
    {
      id: 'step_agendamento_create_task',
      actionType: 'create_task',
      selectorUsed: createTaskButtonSelector,
      journeyId: JOURNEY_ID,
      async execute(page) {
        await waitForRequiredSelector(page, taskTitleInputSelector, 10000, {
          reason: 'agendamento_task_title_input_missing',
          journeyId: JOURNEY_ID,
        });
        await page.fill(taskTitleInputSelector, taskTitle);

        await waitForRequiredSelector(page, taskDueInputSelector, 10000, {
          reason: 'agendamento_task_due_input_missing',
          journeyId: JOURNEY_ID,
        });
        await page.fill(taskDueInputSelector, taskDueDate);

        const createButton = await waitForRequiredSelector(page, createTaskButtonSelector, 10000, {
          reason: 'agendamento_create_task_button_missing',
          journeyId: JOURNEY_ID,
        });
        await createButton.click();

        await waitForRequiredSelector(page, taskCreatedToastSelector, 15000, {
          reason: 'agendamento_task_created_toast_missing',
          journeyId: JOURNEY_ID,
        });
      },
    },

    // ── Step 5: abrir agendamento da tarefa criada ───────────────────────────
    {
      id: 'step_agendamento_open_schedule',
      actionType: 'open_schedule_modal',
      selectorUsed: scheduleButtonSelector,
      journeyId: JOURNEY_ID,
      async execute(page) {
        const scheduleButton = await waitForRequiredSelector(page, scheduleButtonSelector, 15000, {
          reason: 'agendamento_schedule_button_missing',
          journeyId: JOURNEY_ID,
        });
        await scheduleButton.click();

        await waitForRequiredSelector(page, scheduleModalSelector, 15000, {
          reason: 'agendamento_schedule_modal_missing',
          journeyId: JOURNEY_ID,
        });
      },
    },

    // ── Step 6: preencher e confirmar agendamento (SEM mutação de banco) ────
    {
      id: 'step_agendamento_confirm_schedule',
      actionType: 'assert_ui_state',
      selectorUsed: scheduleSubmitSelector,
      journeyId: JOURNEY_ID,
      async execute(page) {
        await waitForRequiredSelector(page, scheduleDateInputSelector, 10000, {
          reason: 'agendamento_schedule_date_input_missing',
          journeyId: JOURNEY_ID,
        });
        await page.fill(scheduleDateInputSelector, scheduleStartAt);

        await waitForRequiredSelector(page, schedulePurposeInputSelector, 10000, {
          reason: 'agendamento_schedule_purpose_input_missing',
          journeyId: JOURNEY_ID,
        });
        await page.fill(schedulePurposeInputSelector, schedulePurpose);

        await waitForRequiredSelector(page, scheduleNotesInputSelector, 10000, {
          reason: 'agendamento_schedule_notes_input_missing',
          journeyId: JOURNEY_ID,
        });
        await page.fill(scheduleNotesInputSelector, scheduleNotes);

        const submitButton = await waitForRequiredSelector(page, scheduleSubmitSelector, 10000, {
          reason: 'agendamento_schedule_submit_missing',
          journeyId: JOURNEY_ID,
        });
        await submitButton.click();

        const toast = await waitForRequiredSelector(page, scheduleCreatedToastSelector, 20000, {
          reason: 'agendamento_schedule_created_toast_missing',
          journeyId: JOURNEY_ID,
        });

        const text = String((await toast?.textContent()) || '').trim().toLowerCase();
        assertOperationalCondition(
          text.includes('agendamento criado'),
          {
            reason: 'agendamento_schedule_not_created',
            journeyId: JOURNEY_ID,
            selector: scheduleCreatedToastSelector,
            actual: text,
          }
        );
      },
    },
  ];
}

module.exports = {
  buildAgendamentoFlowSteps,
  JOURNEY_ID,
  WORKSPACE_PATH,
};
