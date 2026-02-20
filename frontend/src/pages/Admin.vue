<template>
  <div class="admin-shell" style="max-width:1080px; margin:30px auto; padding:0 16px;">
    <div style="position:fixed; top:16px; right:16px; z-index:200; display:grid; gap:10px; max-width:min(420px, calc(100vw - 32px));">
      <div v-for="t in toasts" :key="t.id" :style="toastStyle(t.type)">
        <div style="font-weight:800; line-height:1.3;">{{ t.message }}</div>
        <button @click="removeToast(t.id)"
                style="border:0; background:transparent; font-size:18px; line-height:1; cursor:pointer; color:inherit;">
          ×
        </button>
      </div>
    </div>

    <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap;">
      <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
        <button @click="goBackToOverview"
                style="padding:8px 12px; border-radius:10px; border:1px solid #ddd; background:#fff; font-weight:800;">
          ← Back
        </button>
        <h1 style="margin:0;">Admin: <span data-no-i18n="1">{{ game?.title }}</span></h1>
      </div>
      <div style="display:flex; gap:10px; flex-wrap:wrap;">
        <button v-if="game?.status !== 'live'" @click="startLive"
                style="padding:10px 12px; border-radius:12px; border:0; background:#004e96; color:#fff; font-weight:800;">
          Start game
        </button>
        <button v-else @click="stopGame"
                style="padding:10px 12px; border-radius:12px; border:0; background:#e10011; color:#fff; font-weight:800;">
          Stop game
        </button>
        <button v-if="game?.status !== 'live'" @click="clearAllGuests"
                style="padding:10px 12px; border-radius:12px; border:1px solid #ddd; background:#fff; font-weight:800;">
          Delete all guests + answers
        </button>
        <button @click="deleteGameFromEditor"
                style="padding:10px 12px; border-radius:12px; border:1px solid #e10011; background:#fff1f2; color:#7f1d1d; font-weight:900;">
          Delete game
        </button>
      </div>
    </div>

    <div v-if="game" style="margin-top:12px; opacity:0.8;">
      {{ t("Status: {status} · Questions: {count}", { status: game.status, count: questions.length }) }}
    </div>

    <div class="admin-tabs">
      <button @click="activeTab='game'" :class="['admin-tab', activeTab==='game' ? 'active' : '']">{{ t("Game") }}</button>
      <button @click="activeTab='questions'" :class="['admin-tab', activeTab==='questions' ? 'active' : '']">{{ t("Questions") }}</button>
      <button @click="activeTab='imports'" :class="['admin-tab', activeTab==='imports' ? 'active' : '']">{{ t("Import/Export") }}</button>
    </div>

    <div style="margin-top:18px; display:grid; gap:24px;">
      <div v-if="activeTab==='game' && Object.keys(urls).length" class="admin-card" style="border:1px solid #eee; border-radius:14px; padding:16px;">
        <h2 style="margin:0 0 10px; font-size:18px;">Links</h2>
        <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap:10px;">
          <div v-for="(u, key) in urls" :key="key"
               style="border:2px solid #004e96; border-radius:12px; padding:10px; background:#f0f7ff; display:flex; flex-direction:column; justify-content:space-between; gap:8px;">
            <div style="font-weight:900; text-transform:uppercase; font-size:11px; color:#004e96;">{{ key }}</div>
            <div style="display:flex; gap:6px;">
              <button @click="copy(u)"
                      style="flex:1; padding:6px; border-radius:8px; border:0; background:#004e96; color:#fff; font-weight:800; font-size:12px; cursor:pointer;">
                Copy
              </button>
              <a :href="qrUrlForLinkKey(key)" target="_blank"
                 style="padding:6px; border-radius:8px; border:1px solid #004e96; background:#fff; color:#004e96; font-size:12px; font-weight:800; text-decoration:none; text-align:center;">
                QR
              </a>
            </div>
          </div>
        </div>
      </div>

      <div v-if="activeTab==='game'" class="admin-card" style="border:1px solid #eee; border-radius:14px; padding:16px;">
        <h2 style="margin:0 0 10px;">Current score</h2>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:20px;">
          <div>
            <div style="font-weight:800; color:#e10011; margin-bottom:8px;">{{ playerName }}: {{ score?.player || 0 }} pts.</div>
            <div style="height:12px; background:#eee; border-radius:6px; overflow:hidden;">
              <div :style="{ width: scoreWidth(score?.player), background:'#e10011', height:'100%' }"></div>
            </div>
          </div>
          <div>
            <div style="font-weight:800; color:#004e96; margin-bottom:8px;">Guests: {{ score?.guests || 0 }} pts.</div>
            <div style="height:12px; background:#eee; border-radius:6px; overflow:hidden;">
              <div :style="{ width: scoreWidth(score?.guests), background:'#004e96', height:'100%' }"></div>
            </div>
          </div>
        </div>
        <div style="margin-top:12px; border-top:1px solid #eee; padding-top:12px;">
          <div style="font-weight:800; margin-bottom:8px;">Current guests ({{ guestRankings.length }})</div>
          <div v-if="guestRankings.length===0" style="opacity:0.75; font-size:14px;">No guests joined yet.</div>
          <div v-else style="display:grid; gap:6px;">
            <div v-for="(r, i) in guestRankings" :key="r.id"
                 style="display:flex; justify-content:space-between; align-items:center; padding:6px 10px; border:1px solid #eee; border-radius:10px; background:#fafafa;">
              <div style="font-weight:700;">{{ i + 1 }}. <span data-no-i18n="1">{{ r.nickname }}</span></div>
              <div style="font-weight:800; color:#004e96;">{{ r.score }} pts.</div>
            </div>
          </div>
        </div>
      </div>

      <div v-if="activeTab==='game'" class="admin-card" style="border:1px solid #eee; border-radius:14px; padding:16px;">
        <h2 style="margin:0 0 10px;">Game configuration</h2>
        <div style="display:flex; gap:20px; flex-wrap:wrap; align-items:center;">
          <label style="display:flex; gap:8px; align-items:center; font-weight:700; cursor:pointer;">
            <input type="checkbox" v-model="isPublished" @change="savePublish" style="width:18px; height:18px;" />
            Published (homepage)
          </label>
          <label style="display:flex; gap:8px; align-items:center; font-weight:700; cursor:pointer;">
            <input type="checkbox" v-model="showScore" @change="savePublish" style="width:18px; height:18px;" />
            Show current score
          </label>
          <label style="display:flex; gap:8px; align-items:center; font-weight:700; cursor:pointer;">
            <input type="checkbox" v-model="showQuizTitle" @change="savePublish" style="width:18px; height:18px;" />
            {{ t("Show quiz title (presentation)") }}
          </label>
          <label style="display:flex; gap:8px; align-items:center; font-weight:700; cursor:pointer;">
            <input type="checkbox" v-model="autoRevealEnabled" @change="savePublish" style="width:18px; height:18px;" />
            Auto reveal when everyone has submitted
          </label>
          <label style="display:flex; gap:8px; align-items:center; font-weight:700;">
            Auto reveal delay (seconds)
            <input type="number"
                   min="1"
                   max="60"
                   step="1"
                   v-model.number="autoRevealDelaySeconds"
                   :disabled="!autoRevealEnabled"
                   @change="savePublish"
                   style="width:90px; padding:8px 10px; border-radius:10px; border:1px solid #ddd; background:#fff;" />
          </label>
          <label style="display:flex; gap:8px; align-items:center; font-weight:700;">
            Quiz UI language
            <select v-model="uiLanguage" @change="savePublish"
                    style="padding:8px 10px; border-radius:10px; border:1px solid #ddd; background:#fff;">
              <option v-for="lang in availableLanguages" :key="lang.code" :value="lang.code">{{ lang.label }}</option>
            </select>
          </label>
          <div style="font-size:14px; background:#eee; padding:4px 10px; border-radius:8px;">Status: <b>{{ game?.status }}</b></div>
        </div>
      </div>

      <div v-if="activeTab==='game'" class="admin-card" style="border:1px solid #eee; border-radius:14px; padding:16px;">
        <h2 style="margin:0 0 10px;">Player name</h2>
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <input v-model="playerName" placeholder="Player name"
                 style="flex:1; min-width:240px; padding:10px 12px; border-radius:12px; border:1px solid #ddd;" />
          <button @click="savePlayerName"
                  style="padding:10px 12px; border-radius:12px; border:0; background:#111; color:#fff; font-weight:800;">
            Save
          </button>
        </div>
      </div>

      <div v-if="activeTab==='game'" class="admin-card" style="border:1px solid #eee; border-radius:14px; padding:16px;">
        <h2 style="margin:0 0 10px;">Finish: winner text</h2>
        <div v-if="game?.status==='finished'" style="margin-bottom:10px; font-weight:900;">
          Winner: <span v-if="game?.winner==='player'">{{ playerName }}</span>
          <span v-else-if="game?.winner==='guests'">Guests</span>
          <span v-else>Tie</span>
        </div>
        <div style="display:grid; gap:10px;">
          <div>
            <div style="font-weight:800; margin-bottom:6px;">Text when guests win</div>
            <textarea v-model="guestWinText" rows="3" placeholder="Text for guests win"
                      style="width:100%; padding:10px 12px; border-radius:12px; border:1px solid #ddd;"></textarea>
          </div>
          <div>
            <div style="font-weight:800; margin-bottom:6px;">Text when {{ playerName }} wins</div>
            <textarea v-model="playerWinText" rows="3" placeholder="Text for player win"
                      style="width:100%; padding:10px 12px; border-radius:12px; border:1px solid #ddd;"></textarea>
          </div>
          <div>
            <div style="font-weight:800; margin-bottom:6px;">Text on tie</div>
            <textarea v-model="tieWinText" rows="2" placeholder="Text on tie"
                      style="width:100%; padding:10px 12px; border-radius:12px; border:1px solid #ddd;"></textarea>
          </div>
          <div style="display:flex; gap:10px; flex-wrap:wrap;">
            <button @click="saveWinTexts"
                    style="padding:10px 12px; border-radius:12px; border:0; background:#111; color:#fff; font-weight:800;">
              Save
            </button>
          </div>
        </div>
      </div>

      <div v-if="activeTab==='imports'" class="admin-card" style="border:1px solid #eee; border-radius:14px; padding:16px;">
        <h2 style="margin:0 0 8px;">Import/Export</h2>
        <div style="font-size:13px; opacity:0.82; margin-bottom:14px;">
          Apply, export, or save question packages with media.
        </div>

        <details class="import-step" open>
          <summary>Apply template</summary>
          <div class="import-step-body">
            <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap:10px; align-items:center;">
              <select v-model="selectedPackageId" style="padding:10px 12px; border-radius:12px; border:1px solid #ddd;">
                <option value="">Select package…</option>
                <option v-for="p in packageTemplates" :key="p.id" :value="p.id">
                  {{ p.name }} ({{ p.kind === "builtin" ? "Template" : "Custom" }}, {{ p.questionCount }} questions)
                </option>
              </select>
              <select v-model="packageApplyMode" style="padding:10px 12px; border-radius:12px; border:1px solid #ddd;">
                <option value="replace">Replace</option>
                <option value="append">Append</option>
              </select>
              <button @click="applySelectedPackage"
                      style="padding:10px 12px; border-radius:12px; border:0; background:#004e96; color:#fff; font-weight:800;">
                Apply
              </button>
            </div>
            <div v-if="selectedPackage" style="font-size:13px; opacity:0.82;">
              {{ selectedPackage.description || "No description." }}
            </div>
            <div style="display:flex; justify-content:flex-end;">
              <button @click="loadPackages"
                      :disabled="packageLoading"
                      :style="packageLoading
                        ? 'padding:8px 10px; border-radius:10px; border:1px solid #ddd; background:#f5f5f5; color:#777; font-weight:800;'
                        : 'padding:8px 10px; border-radius:10px; border:1px solid #ddd; background:#fff; font-weight:800;'">
                Reload packages
              </button>
            </div>
          </div>
        </details>

        <details class="import-step">
          <summary>Export</summary>
          <div class="import-step-body">
            <div style="font-size:13px; opacity:0.82;">Export current questions including media as a file.</div>
            <div style="display:flex; gap:10px; flex-wrap:wrap;">
              <button @click="exportQuestionPackage('json')"
                      style="padding:10px 12px; border-radius:12px; border:1px solid #ddd; background:#fff; font-weight:800;">
                Export JSON
              </button>
              <button @click="exportQuestionPackage('csv')"
                      style="padding:10px 12px; border-radius:12px; border:1px solid #ddd; background:#fff; font-weight:800;">
                Export CSV
              </button>
            </div>
          </div>
        </details>

        <details class="import-step">
          <summary>Import</summary>
          <div class="import-step-body">
            <div style="font-size:13px; opacity:0.82;">Select a file and choose replace or append.</div>
            <div style="display:flex; gap:10px; flex-wrap:wrap;">
              <select v-model="importMode" style="padding:10px 12px; border-radius:12px; border:1px solid #ddd;">
                <option value="replace">Replace questions</option>
                <option value="append">Append questions</option>
              </select>
              <input ref="importFileInput" type="file" accept=".json,.csv,application/json,text/csv" @change="onImportFileChange"
                     style="padding:8px; border-radius:12px; border:1px solid #ddd; background:#fff;" />
            </div>
            <input v-model="importSaveTemplateName" placeholder="Optional: save as custom package"
                   style="padding:10px 12px; border-radius:12px; border:1px solid #ddd;" />
            <div>
              <button @click="runImportPackage"
                      :disabled="importBusy || !importFile"
                      :style="importBusy || !importFile
                        ? 'padding:10px 12px; border-radius:12px; border:1px solid #ddd; background:#f5f5f5; color:#777; font-weight:800;'
                        : 'padding:10px 12px; border-radius:12px; border:0; background:#004e96; color:#fff; font-weight:800;'">
                Start import
              </button>
            </div>
          </div>
        </details>

        <details class="import-step">
          <summary>Save current game as package</summary>
          <div class="import-step-body">
            <div style="display:flex; gap:10px; flex-wrap:wrap;">
              <input v-model="newPackageName" placeholder="Package name"
                     style="flex:1; min-width:220px; padding:10px 12px; border-radius:12px; border:1px solid #ddd;" />
              <button @click="saveCurrentAsPackage"
                      style="padding:10px 12px; border-radius:12px; border:0; background:#111; color:#fff; font-weight:800;">
                Save as package
              </button>
            </div>
            <textarea v-model="newPackageDescription" rows="2" placeholder="Description (optional)"
                      style="width:100%; padding:10px 12px; border-radius:12px; border:1px solid #ddd;"></textarea>
          </div>
        </details>
      </div>

      <div v-if="activeTab==='questions'" class="admin-card" style="border:1px solid #eee; border-radius:14px; padding:16px;">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:10px;">
          <h2 style="margin:0;">Question list (Drag & Drop + blocks)</h2>
          <div style="display:flex; gap:10px; flex-wrap:wrap;">
            <button @click="openCreateQuestionModal"
                    style="padding:10px 12px; border-radius:12px; border:0; background:#111; color:#fff; font-weight:800;">
              Add new question
            </button>
            <button @click="saveQuestionOrder"
                    :disabled="!orderDirty"
                    :style="orderDirty
                      ? 'padding:10px 12px; border-radius:12px; border:0; background:#004e96; color:#fff; font-weight:800;'
                      : 'padding:10px 12px; border-radius:12px; border:1px solid #ddd; background:#f5f5f5; color:#777; font-weight:800;'">
              Save order
            </button>
          </div>
        </div>

        <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:12px;">
          <input v-model="newBlockLabel" placeholder="New block name"
                 style="flex:1; min-width:220px; padding:10px 12px; border-radius:12px; border:1px solid #ddd;" />
          <button @click="addBlock"
                  style="padding:10px 12px; border-radius:12px; border:1px solid #ddd; background:#fff; font-weight:800;">
            Add block
          </button>
        </div>

        <div v-if="questions.length === 0" style="opacity:0.8;">No questions yet.</div>
        <ol style="margin:0; padding-left:18px; display:grid; gap:8px;">
          <li v-for="entry in questionOrderEntries"
              :key="entry.key"
              :style="entry.kind==='placeholder'
                ? 'list-style:none; margin-left:-18px;'
                : 'margin-bottom:0;'">
            <div v-if="entry.kind==='placeholder'"
                 style="height:66px; border:2px dashed #94a3b8; border-radius:12px; background:#f8fafc;"></div>

            <div v-else
                 :data-question-id="entry.question.id"
                 @pointerdown="onQuestionCardPointerDown($event, entry.question.id)"
                 :style="entry.isSource
                   ? 'border:0; border-radius:0; background:transparent; padding:0; margin:0; height:0; opacity:0; overflow:hidden;'
                   : 'border:1px solid #ddd; border-radius:12px; background:#fff; padding:10px;'">
              <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:10px; flex-wrap:wrap;">
                <div>
                  <div data-no-i18n="1" style="font-weight:700;">{{ entry.question.text }}</div>
                  <div style="font-size:13px; opacity:0.8; margin-top:4px;">
                    Type: {{ questionTypeLabel(entry.question.type) }}
                    · {{ entry.question.Options?.length || 0 }} options
                    · Guests ≥ {{ normalizeGuestThresholdPercent(entry.question.guestCorrectThresholdPercent) }}%
                    <span v-if="entry.question.type==='risk'"> · +/-2 points</span>
                  </div>
                  <div style="margin-top:8px;">
                    <select :value="entry.question.blockLabel"
                            @change="setQuestionBlock(entry.question.id, $event.target.value)"
                            style="padding:6px 10px; border-radius:10px; border:1px solid #ddd; font-size:12px;">
                      <option v-for="b in blockOptions" :key="b" :value="b">{{ b }}</option>
                    </select>
                  </div>
                </div>
                <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                  <button v-if="!entry.isSource"
                          @pointerdown.prevent.stop="startQuestionPointer($event, entry.question.id)"
                          style="padding:4px 8px; border-radius:8px; border:1px solid #ddd; background:#fff; cursor:grab; touch-action:none;">
                    ⇅ drag
                  </button>
                  <button @click="openEditQuestionModal(entry.question)"
                          style="padding:8px 10px; border-radius:10px; border:1px solid #ddd; background:#fff; font-weight:800;">
                    Edit
                  </button>
                  <button @click="deleteQuestion(entry.question)"
                          style="padding:8px 10px; border-radius:10px; border:1px solid #ddd; background:#fff; font-weight:800;">
                    Delete
                  </button>
                </div>
              </div>
            </div>
          </li>
        </ol>
        <div v-if="draggingQuestionId"
             data-question-end="1"
             style="margin-top:8px; border:1px dashed #cbd5e1; border-radius:10px; padding:6px 8px; font-size:12px; color:#475569; background:#fff;">
          Hier ablegen, um ans Ende zu verschieben
        </div>
      </div>
    </div>

    <div v-if="questionModalOpen" @click.self="closeQuestionModal"
         style="position:fixed; inset:0; background:rgba(0,0,0,0.4); z-index:60; display:flex; align-items:center; justify-content:center; padding:16px;">
      <div style="width:min(980px,100%); max-height:90vh; overflow:auto; background:#fff; border-radius:16px; border:1px solid #ddd; box-shadow:0 14px 30px rgba(0,0,0,0.2); padding:16px;">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:10px;">
          <h2 style="margin:0;">{{ editingId ? "Edit question" : "New question" }}</h2>
          <button @click="closeQuestionModal"
                  style="padding:8px 10px; border-radius:10px; border:1px solid #ddd; background:#fff; font-weight:800;">
            Close
          </button>
        </div>

        <textarea v-model="qText" rows="3" placeholder="Question text"
                  @input="touchQuestionField('text')"
                  @blur="touchQuestionField('text')"
                  :class="{ 'input-invalid': showQuestionError('text') }"
                  style="width:100%; padding:10px 12px; border-radius:12px; border:1px solid #ddd;"></textarea>
        <div v-if="showQuestionError('text')" class="field-error">{{ questionErrors.text }}</div>

        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap:10px; margin-top:10px;">
          <input v-model="qBlockLabel" placeholder="Block name"
                 @input="touchQuestionField('blockLabel')"
                 @blur="touchQuestionField('blockLabel')"
                 :class="{ 'input-invalid': showQuestionError('blockLabel') }"
                 style="padding:10px 12px; border-radius:12px; border:1px solid #ddd;" />
          <select v-model="qType" @change="touchQuestionField('type')" style="padding:10px 12px; border-radius:12px; border:1px solid #ddd;">
            <option value="choice">Standard (Single/Multi)</option>
            <option value="estimate">Estimate question</option>
            <option value="order">Order question</option>
            <option value="risk">Risk question (+2 / -2)</option>
          </select>
          <label style="display:grid; gap:6px; padding:8px 0;">
            <span style="font-size:13px; font-weight:800; color:#334155;">{{ t("Guest correct threshold (%)") }}</span>
            <input v-model.number="guestCorrectThresholdPercent" type="number" min="0" max="100" step="1"
                   style="padding:10px 12px; border-radius:12px; border:1px solid #ddd;" />
          </label>
        </div>
        <div v-if="showQuestionError('blockLabel')" class="field-error">{{ questionErrors.blockLabel }}</div>

        <div v-if="qType==='choice' || qType==='risk'" style="display:flex; align-items:center; gap:10px; margin-top:10px;">
          <input type="checkbox" v-model="allowMultiple" id="multi" @change="touchQuestionField('correctSelection')"/>
          <label for="multi">Multiple answers allowed</label>
        </div>

        <div v-if="qType==='estimate'" style="margin-top:12px; border:1px solid #eee; border-radius:12px; padding:12px; background:#fafafa; display:grid; gap:10px;">
          <div style="font-weight:800;">Estimate question Einstellungen</div>
          <input v-model="estimateTarget" type="number" step="any" placeholder="Target value (e.g. 42)"
                 @input="touchQuestionField('estimateTarget')"
                 @blur="touchQuestionField('estimateTarget')"
                 :class="{ 'input-invalid': showQuestionError('estimateTarget') }"
                 style="padding:10px 12px; border-radius:12px; border:1px solid #ddd;" />
          <div v-if="showQuestionError('estimateTarget')" class="field-error">{{ questionErrors.estimateTarget }}</div>
          <input v-model="estimateTolerance" type="number" min="0" step="any" placeholder="Tolerance (e.g. 5)"
                 @input="touchQuestionField('estimateTolerance')"
                 @blur="touchQuestionField('estimateTolerance')"
                 :class="{ 'input-invalid': showQuestionError('estimateTolerance') }"
                 style="padding:10px 12px; border-radius:12px; border:1px solid #ddd;" />
          <div v-if="showQuestionError('estimateTolerance')" class="field-error">{{ questionErrors.estimateTolerance }}</div>
        </div>

        <div style="margin-top:12px; border:1px solid #eee; border-radius:12px; padding:12px; background:#fafafa; display:grid; gap:8px;">
          <div style="font-weight:800;">Question media (image/audio/video)</div>
          <input v-model="promptMedia" @input="touchQuestionField('promptMedia'); onPromptMediaInput()" @blur="touchQuestionField('promptMedia')" placeholder="Media URL (or choose file below)"
                 :class="{ 'input-invalid': showQuestionError('promptMedia') }"
                 style="width:100%; padding:10px 12px; border-radius:12px; border:1px solid #ddd;" />
          <input type="file" accept="image/*,audio/*,video/*" @change="onPromptMediaFile" />
          <div v-if="showQuestionError('promptMedia')" class="field-error">{{ questionErrors.promptMedia }}</div>
          <img v-if="promptMedia && promptMediaKind==='image'" :src="promptMedia" alt="Media preview"
               @click="openFullscreenImage(promptMedia)"
               class="clickable-image"
               style="max-width:280px; max-height:180px; object-fit:contain; border:1px solid #ddd; border-radius:10px; background:#fff; padding:6px;" />
          <audio v-else-if="promptMedia && promptMediaKind==='audio'" :src="promptMedia" controls preload="metadata"></audio>
          <video v-else-if="promptMedia && promptMediaKind==='video'" :src="promptMedia" controls preload="metadata"
                 style="max-width:340px; max-height:220px; border:1px solid #ddd; border-radius:10px; background:#000;"></video>
        </div>

        <div v-if="qType !== 'estimate'" style="margin-top:12px; display:grid; gap:10px;">
          <div style="font-weight:800;">
            {{ qType==='order' ? 'Options in correct order' : 'Answer options' }}
          </div>
          <div v-for="(o, idx) in options" :key="idx"
               :data-edit-order-index="idx"
               :style="qType==='order'
                 ? 'display:flex; gap:10px; align-items:center; flex-wrap:wrap; border:1px solid #e5e7eb; border-radius:10px; padding:8px; background:#fff;'
                 : 'display:flex; gap:10px; align-items:center; flex-wrap:wrap;'">
            <input v-model="o.text" placeholder="Answer"
                   @input="touchQuestionField('options')"
                   @blur="touchQuestionField('options')"
                   :class="{ 'input-invalid': showQuestionError('options') }"
                   style="flex:1; min-width:220px; padding:10px 12px; border-radius:12px; border:1px solid #ddd;" />
            <input v-model="o.image" placeholder="Option image URL (optional)"
                   @input="touchQuestionField('options'); onOptionImageInput(idx)"
                   @blur="touchQuestionField('options')"
                   style="flex:1; min-width:220px; padding:10px 12px; border-radius:12px; border:1px solid #ddd;" />
            <input type="file" accept="image/*" @change="onOptionImageFile($event, idx)" />
            <img v-if="o.image" :src="o.image" alt="Option image preview"
                 @click="openFullscreenImage(o.image)"
                 class="clickable-image"
                 style="max-width:120px; max-height:72px; object-fit:cover; border:1px solid #ddd; border-radius:10px; background:#fff; padding:4px;" />
            <template v-if="qType==='order'">
              <button @pointerdown.prevent.stop="startOptionPointer($event, idx)"
                      style="padding:4px 8px; border-radius:8px; border:1px solid #ddd; background:#fff; cursor:grab; touch-action:none;">
                ⇅
              </button>
              <button @click="moveOption(idx, -1)"
                      :disabled="idx===0"
                      style="padding:8px 10px; border-radius:10px; border:1px solid #ddd; background:#fff;">
                ↑
              </button>
              <button @click="moveOption(idx, 1)"
                      :disabled="idx===options.length-1"
                      style="padding:8px 10px; border-radius:10px; border:1px solid #ddd; background:#fff;">
                ↓
              </button>
            </template>
            <label v-else style="display:flex; gap:8px; align-items:center; white-space:nowrap;">
              <input type="checkbox" v-model="o.isCorrect" @change="touchQuestionField('correctSelection')" />
              richtig
            </label>
            <button @click="removeOption(idx)"
                    style="padding:10px 12px; border-radius:12px; border:1px solid #ddd; background:#fff;">
              ✕
            </button>
          </div>
          <div v-if="showQuestionError('options')" class="field-error">{{ questionErrors.options }}</div>
          <div v-if="showQuestionError('correctSelection')" class="field-error">{{ questionErrors.correctSelection }}</div>
          <button @click="addOption"
                  style="width:max-content; padding:10px 12px; border-radius:12px; border:1px solid #ddd; background:#fff;">
            Add option
          </button>
        </div>

        <div style="margin-top:12px; border:1px solid #eee; border-radius:12px; padding:12px; background:#fafafa;">
          <div style="font-weight:800; margin-bottom:10px;">Solution after reveal</div>
          <div style="display:flex; gap:16px; flex-wrap:wrap; margin-bottom:10px;">
            <label style="display:flex; align-items:center; gap:6px;">
              <input type="radio" value="none" v-model="solutionType" @change="touchQuestionField('solutionText'); touchQuestionField('solutionMedia')" />
              keine
            </label>
            <label style="display:flex; align-items:center; gap:6px;">
              <input type="radio" value="text" v-model="solutionType" @change="touchQuestionField('solutionText'); touchQuestionField('solutionMedia')" />
              Text
            </label>
            <label style="display:flex; align-items:center; gap:6px;">
              <input type="radio" value="image" v-model="solutionType" @change="touchQuestionField('solutionText'); touchQuestionField('solutionMedia')" />
              Media
            </label>
            <label style="display:flex; align-items:center; gap:6px;">
              <input type="radio" value="both" v-model="solutionType" @change="touchQuestionField('solutionText'); touchQuestionField('solutionMedia')" />
              Media + text
            </label>
          </div>

          <div v-if="solutionType==='text' || solutionType==='both'">
            <textarea v-model="solutionText" rows="4" placeholder="Explanation / solution text"
                      @input="touchQuestionField('solutionText')"
                      @blur="touchQuestionField('solutionText')"
                      :class="{ 'input-invalid': showQuestionError('solutionText') }"
                      style="width:100%; padding:10px 12px; border-radius:12px; border:1px solid #ddd;"></textarea>
            <div v-if="showQuestionError('solutionText')" class="field-error">{{ questionErrors.solutionText }}</div>
          </div>

          <div v-if="solutionType==='image' || solutionType==='both'" style="display:grid; gap:8px; margin-top:8px;">
            <input v-model="solutionMedia" @input="touchQuestionField('solutionMedia'); onSolutionMediaInput()" @blur="touchQuestionField('solutionMedia')" placeholder="Media URL (or choose file below)"
                   :class="{ 'input-invalid': showQuestionError('solutionMedia') }"
                   style="width:100%; padding:10px 12px; border-radius:12px; border:1px solid #ddd;" />
            <input type="file" accept="image/*,audio/*,video/*" @change="onSolutionMediaFile" />
            <div v-if="showQuestionError('solutionMedia')" class="field-error">{{ questionErrors.solutionMedia }}</div>
            <img v-if="solutionMedia && solutionMediaKind==='image'" :src="solutionMedia" alt="Solution preview"
                 @click="openFullscreenImage(solutionMedia)"
                 class="clickable-image"
                 style="max-width:280px; max-height:180px; object-fit:contain; border:1px solid #ddd; border-radius:10px; background:#fff; padding:6px;" />
            <audio v-else-if="solutionMedia && solutionMediaKind==='audio'" :src="solutionMedia" controls preload="metadata"></audio>
            <video v-else-if="solutionMedia && solutionMediaKind==='video'" :src="solutionMedia" controls preload="metadata"
                   style="max-width:340px; max-height:220px; border:1px solid #ddd; border-radius:10px; background:#000;"></video>
          </div>
        </div>

        <div style="margin-top:12px; display:flex; gap:10px; flex-wrap:wrap;">
          <button @click="saveQuestion"
                  :disabled="!isQuestionFormValid"
                  :style="isQuestionFormValid
                    ? 'padding:10px 12px; border-radius:12px; border:0; background:#111; color:#fff; font-weight:700;'
                    : 'padding:10px 12px; border-radius:12px; border:1px solid #ddd; background:#f5f5f5; color:#777; font-weight:700;'">
            {{ editingId ? 'Update' : 'Save' }}
          </button>
          <button v-if="editingId" @click="cancelEdit"
                  style="padding:10px 12px; border-radius:12px; border:1px solid #ddd; background:#fff; font-weight:800;">
            Cancel
          </button>
        </div>
      </div>
    </div>

    <div v-if="fullscreenImageSrc" class="image-viewer" @click.self="closeFullscreenImage">
      <button @click="closeFullscreenImage" class="image-viewer-close">×</button>
      <img :src="fullscreenImageSrc" alt="Fullscreen" class="image-viewer-img" />
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { getSocket } from "../socket.js";
import api from "../api.js";
import { appLinksFromTokens, qrUrlForTargetUrl } from "../linkUtils.js";
import { setLanguage, useI18n } from "../i18n.js";

const props = defineProps({ token: String });
const socket = getSocket();
const router = useRouter();
const { availableLanguages, t } = useI18n();

const game = ref(null);
const questions = ref([]);
const activeTab = ref("game");
const playerName = ref("");
const links = ref(null);
const guestWinText = ref("");
const playerWinText = ref("");
const tieWinText = ref("");
const isPublished = ref(false);
const showScore = ref(true);
const showQuizTitle = ref(true);
const autoRevealEnabled = ref(true);
const autoRevealDelaySeconds = ref(2);
const uiLanguage = ref("en");
const score = ref(null);
const orderDirty = ref(false);

const editingId = ref(null);
const questionModalOpen = ref(false);
const qText = ref("");
const qType = ref("choice");
const qBlockLabel = ref("General");
const allowMultiple = ref(false);
const promptMedia = ref("");
const promptMediaKind = ref("");
const promptImage = ref("");
const promptAudio = ref("");
const promptVideo = ref("");
const estimateTarget = ref("");
const estimateTolerance = ref("0");
const solutionType = ref("none");
const solutionText = ref("");
const solutionMedia = ref("");
const solutionMediaKind = ref("");
const solutionImage = ref("");
const solutionAudio = ref("");
const solutionVideo = ref("");
const guestCorrectThresholdPercent = ref(50);
const options = ref([
  { text: "", image: "", isCorrect: false },
  { text: "", image: "", isCorrect: false },
  { text: "", image: "", isCorrect: false },
  { text: "", image: "", isCorrect: false }
]);

const newBlockLabel = ref("");
const manualBlocks = ref([]);
const draggingQuestionId = ref(null);
const questionDropIndex = ref(null);
const draggingOptionIndex = ref(null);

const toasts = ref([]);
let toastSeq = 1;

const packageTemplates = ref([]);
const packageLoading = ref(false);
const selectedPackageId = ref("");
const packageApplyMode = ref("replace");
const newPackageName = ref("");
const newPackageDescription = ref("");
const importMode = ref("replace");
const importSaveTemplateName = ref("");
const importFile = ref(null);
const importFileInput = ref(null);
const importBusy = ref(false);
const questionFieldTouched = ref({});
const fullscreenImageSrc = ref("");

const blockOptions = computed(() => {
  const set = new Set(["General", ...manualBlocks.value]);
  for (const q of questions.value) set.add(normalizeBlockLabel(q.blockLabel));
  return [...set.values()];
});

const guestRankings = computed(() => {
  const arr = Array.isArray(score.value?.rankings) ? score.value.rankings : [];
  return arr.map(r => ({
    id: r.id,
    nickname: r.nickname || `Guest ${r.id}`,
    score: Number(r.score || 0)
  }));
});

const urls = computed(() => appLinksFromTokens(links.value || {}));
const selectedPackage = computed(() => {
  const id = String(selectedPackageId.value || "");
  if (!id) return null;
  return packageTemplates.value.find(p => p.id === id) || null;
});

const questionOrderEntries = computed(() => {
  const dragId = draggingQuestionId.value;
  if (!dragId) {
    return questions.value.map(q => ({ kind: "item", key: `q-${q.id}`, question: q, isSource: false }));
  }
  const idxRaw = Number(questionDropIndex.value);
  const idx = Number.isFinite(idxRaw) ? Math.max(0, Math.min(questions.value.length, idxRaw)) : questions.value.length;
  const entries = [];
  for (let i = 0; i < questions.value.length; i++) {
    if (i === idx) entries.push({ kind: "placeholder", key: "q-placeholder" });
    const q = questions.value[i];
    entries.push({ kind: "item", key: `q-${q.id}`, question: q, isSource: q.id === dragId });
  }
  if (idx === questions.value.length) entries.push({ kind: "placeholder", key: "q-placeholder-end" });
  return entries;
});

const questionErrors = computed(() => {
  const errors = {
    text: "",
    blockLabel: "",
    estimateTarget: "",
    estimateTolerance: "",
    promptMedia: "",
    options: "",
    correctSelection: "",
    solutionText: "",
    solutionMedia: ""
  };

  if (!String(qText.value || "").trim()) {
    errors.text = "Please enter a question text.";
  }
  if (!String(qBlockLabel.value || "").trim()) {
    errors.blockLabel = "Please enter a block name.";
  }

  if (qType.value === "estimate") {
    const target = Number.parseFloat(String(estimateTarget.value || "").trim());
    const tolerance = Number.parseFloat(String(estimateTolerance.value || "").trim());
    if (!Number.isFinite(target)) {
      errors.estimateTarget = "Please enter a valid target value.";
    }
    if (!Number.isFinite(tolerance) || tolerance < 0) {
      errors.estimateTolerance = "Tolerance must be a number >= 0.";
    }
  }

  if (String(promptMedia.value || "").trim() && !["image", "audio", "video"].includes(String(promptMediaKind.value || ""))) {
    errors.promptMedia = "Media must be image, audio or video.";
  }

  if (qType.value !== "estimate") {
    const normalizedOptions = (options.value || []).map(o => ({
      text: String(o?.text || "").trim(),
      image: String(o?.image || "").trim(),
      isCorrect: !!o?.isCorrect
    }));
    const nonEmptyOptions = normalizedOptions.filter(o => o.text.length > 0 || o.image.length > 0);
    if (nonEmptyOptions.length < 2) {
      errors.options = "Please fill at least 2 answer options (text or image).";
    } else if (normalizedOptions.some(o => {
      const medium = inferMediumFromRef(o.image);
      return o.image && medium && medium !== "image";
    })) {
      errors.options = "Option images must be valid image URLs/uploads.";
    }
    if (qType.value !== "order") {
      const correctCount = normalizedOptions.filter(o => (o.text || o.image) && o.isCorrect).length;
      if (allowMultiple.value) {
        if (correctCount < 1) errors.correctSelection = "Select at least one correct option.";
      } else if (correctCount !== 1) {
        errors.correctSelection = "Select exactly one correct option for single choice.";
      }
    }
  }

  if (solutionType.value === "text" || solutionType.value === "both") {
    if (!String(solutionText.value || "").trim()) {
      errors.solutionText = "Please enter a solution text.";
    }
  }
  if (solutionType.value === "image" || solutionType.value === "both") {
    if (!String(solutionMedia.value || "").trim()) {
      errors.solutionMedia = "Please provide solution media.";
    } else if (!["image", "audio", "video"].includes(String(solutionMediaKind.value || ""))) {
      errors.solutionMedia = "Solution media must be image, audio or video.";
    }
  }

  return errors;
});

const isQuestionFormValid = computed(() => {
  const current = questionErrors.value;
  return !Object.values(current).some(Boolean);
});

onMounted(async () => {
  setupSocket();
  await load();
  await loadPackages();
});

function normalizeBlockLabel(raw) {
  const text = String(raw || "").trim();
  return text || "General";
}

function touchQuestionField(field) {
  questionFieldTouched.value = {
    ...questionFieldTouched.value,
    [field]: true
  };
}

function resetQuestionFieldTouched() {
  questionFieldTouched.value = {};
}

function showQuestionError(field) {
  return !!questionFieldTouched.value[field] && !!questionErrors.value[field];
}

function openFullscreenImage(src) {
  const value = String(src || "").trim();
  if (!value) return;
  fullscreenImageSrc.value = value;
}

function closeFullscreenImage() {
  fullscreenImageSrc.value = "";
}

function touchAllQuestionFields() {
  questionFieldTouched.value = {
    text: true,
    blockLabel: true,
    estimateTarget: true,
    estimateTolerance: true,
    promptMedia: true,
    options: true,
    correctSelection: true,
    solutionText: true,
    solutionMedia: true
  };
}

function goBackToOverview() {
  router.push("/admin");
}

function scoreWidth(value) {
  const v = Math.max(0, Number(value || 0));
  return `${Math.max(0, Math.min(100, v * 12))}%`;
}

function normalizeAutoRevealDelaySeconds(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 2;
  return Math.max(1, Math.min(60, Math.round(n)));
}

function normalizeGuestThresholdPercent(value) {
  if (value === null || value === undefined || String(value).trim() === "") return 50;
  const n = Number(value);
  if (!Number.isFinite(n)) return 50;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function questionTypeLabel(type) {
  const t = String(type || "choice");
  if (t === "estimate") return "Estimate question";
  if (t === "order") return "Order";
  if (t === "image_identity" || t === "audio_identity" || t === "video_identity") return "Media";
  if (t === "risk") return "Risk";
  return "Standard";
}

function questionErrorText(code) {
  const c = String(code || "error");
  if (c === "invalid_prompt_media") return "Media question: please provide image, audio or video.";
  if (c === "invalid_prompt_image") return "Image question: please provide an image.";
  if (c === "invalid_prompt_audio") return "Audio question: please provide an audio file/URL.";
  if (c === "invalid_prompt_video") return "Video question: please provide a video file/URL.";
  if (c === "invalid_media_kind") return "Invalid upload type.";
  if (c === "invalid_media_type") return "File type does not match the selected field.";
  if (c === "missing_file") return "No file provided.";
  if (c === "media_too_large") return "File exceeds server limit.";
  if (c === "media_upload_error") return "File could not be processed.";
  if (c === "upload_failed") return "Upload/optimization failed.";
  if (c === "payload_too_large") return "Upload is too large for the server. Please use a smaller file.";
  if (c === "no_questions") return "No questions available.";
  if (c === "missing_package_id") return "Please select a question package first.";
  if (c === "package_not_found") return "Question package not found.";
  if (c === "invalid_json") return "JSON file is invalid.";
  if (c.startsWith("missing_csv_column_")) return "CSV file does not include all required columns.";
  if (c === "game_live") return "This action is blocked during a live game.";
  return `Error: ${c}`;
}

function inferMediumFromRef(raw) {
  const value = String(raw || "").trim().toLowerCase();
  if (!value) return "";
  if (value.startsWith("data:image/")) return "image";
  if (value.startsWith("data:audio/")) return "audio";
  if (value.startsWith("data:video/")) return "video";

  const clean = value.split("?")[0].split("#")[0];
  if (/\.(png|jpe?g|webp|gif|bmp|avif|tiff?|svg)$/.test(clean)) return "image";
  if (/\.(mp3|m4a|aac|wav|ogg|oga|flac|opus)$/.test(clean)) return "audio";
  if (/\.(mp4|mov|m4v|webm|mkv|avi|mpeg|mpg|ogv)$/.test(clean)) return "video";
  return "";
}

function setPromptMedia(url, mediumHint = "") {
  const value = String(url || "").trim();
  const medium = mediumHint || inferMediumFromRef(value);
  promptMedia.value = value;
  promptMediaKind.value = medium;
  promptImage.value = medium === "image" ? value : "";
  promptAudio.value = medium === "audio" ? value : "";
  promptVideo.value = medium === "video" ? value : "";
}

function setSolutionMedia(url, mediumHint = "") {
  const value = String(url || "").trim();
  const medium = mediumHint || inferMediumFromRef(value);
  solutionMedia.value = value;
  solutionMediaKind.value = medium;
  solutionImage.value = medium === "image" ? value : "";
  solutionAudio.value = medium === "audio" ? value : "";
  solutionVideo.value = medium === "video" ? value : "";
}

async function load() {
  const { data } = await api.get(`/state/${props.token}`);
  game.value = data.game;
  questions.value = (data.questions || []).map(q => ({
    ...q,
    blockLabel: normalizeBlockLabel(q.blockLabel)
  }));
  playerName.value = data.player?.nickname || "";
  isPublished.value = !!data.game?.isPublished;
  showScore.value = data.game?.showScore !== false;
  showQuizTitle.value = data.game?.showQuizTitle !== false;
  autoRevealEnabled.value = data.game?.autoRevealEnabled !== false;
  autoRevealDelaySeconds.value = normalizeAutoRevealDelaySeconds(data.game?.autoRevealDelaySeconds);
  uiLanguage.value = String(data.game?.uiLanguage || "en");
  await setLanguage(uiLanguage.value);
  score.value = data.score;
  links.value = data.links || null;
  guestWinText.value = data.game?.guestWinText || "";
  playerWinText.value = data.game?.playerWinText || "";
  tieWinText.value = data.game?.tieWinText || "";
  if (!String(newPackageName.value || "").trim()) {
    newPackageName.value = `${data.game?.title || "Quiz"} package`;
  }
  orderDirty.value = false;
}

function qrUrlForLinkKey(key) {
  const targetUrl = urls.value?.[key] || "";
  return qrUrlForTargetUrl(targetUrl);
}

function fileNameFromDisposition(disposition, fallback) {
  const raw = String(disposition || "");
  const star = raw.match(/filename\*=UTF-8''([^;]+)/i);
  if (star?.[1]) return decodeURIComponent(star[1]);
  const plain = raw.match(/filename=\"?([^\";]+)\"?/i);
  return plain?.[1] || fallback;
}

function downloadBlob(blob, fileName) {
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1200);
}

async function loadPackages() {
  packageLoading.value = true;
  const { data } = await api.get(`/admin/${props.token}/question-packages`)
    .catch(e => ({ data: { error: e?.response?.data?.error || "error" } }));
  packageLoading.value = false;
  if (Array.isArray(data?.packages)) {
    packageTemplates.value = data.packages;
    if (!selectedPackageId.value && packageTemplates.value.length) {
      selectedPackageId.value = packageTemplates.value[0].id;
    } else if (selectedPackageId.value && !packageTemplates.value.some(p => p.id === selectedPackageId.value)) {
      selectedPackageId.value = "";
    }
    return;
  }
  showToast(questionErrorText(data?.error), "error");
}

async function applySelectedPackage() {
  if (!selectedPackageId.value) {
    showToast("Please select a question package.", "error");
    return;
  }
  if (!confirm(packageApplyMode.value === "replace"
    ? "Apply selected package and replace current questions?"
    : "Append selected package to existing questions?")) {
    return;
  }
  const { data } = await api.post(`/admin/${props.token}/question-packages/apply`, {
    packageId: selectedPackageId.value,
    mode: packageApplyMode.value
  }).catch(e => ({ data: { error: e?.response?.data?.error || "error" } }));
  if (data?.ok) {
    showToast(`Question package imported (${data.imported || 0} questions).`, "success");
    await load();
    return;
  }
  showToast(questionErrorText(data?.error), "error");
}

async function saveCurrentAsPackage() {
  const name = String(newPackageName.value || "").trim();
  if (!name) {
    showToast("Please enter a package name.", "error");
    return;
  }
  const { data } = await api.post(`/admin/${props.token}/question-packages/save`, {
    name,
    description: newPackageDescription.value
  }).catch(e => ({ data: { error: e?.response?.data?.error || "error" } }));
  if (data?.ok) {
    showToast("Custom question package saved.", "success");
    newPackageName.value = "";
    newPackageDescription.value = "";
    await loadPackages();
    return;
  }
  showToast(questionErrorText(data?.error), "error");
}

async function exportQuestionPackage(format) {
  const targetFormat = format === "csv" ? "csv" : "json";
  try {
    const res = await api.get(`/admin/${props.token}/question-packages/export`, {
      params: { format: targetFormat },
      responseType: "blob"
    });
    const fallbackName = `question-package.${targetFormat}`;
    const fileName = fileNameFromDisposition(res?.headers?.["content-disposition"], fallbackName);
    downloadBlob(res.data, fileName);
    showToast(`Export (${targetFormat.toUpperCase()}) ready.`, "success");
  } catch (err) {
    const code = err?.response?.data?.error || "error";
    showToast(questionErrorText(code), "error");
  }
}

function onImportFileChange(evt) {
  importFile.value = evt?.target?.files?.[0] || null;
}

async function runImportPackage() {
  if (!importFile.value) {
    showToast("Please select a file first.", "error");
    return;
  }
  importBusy.value = true;
  const form = new FormData();
  form.append("file", importFile.value);
  form.append("mode", importMode.value);
  if (String(importSaveTemplateName.value || "").trim()) {
    form.append("saveAsTemplate", String(importSaveTemplateName.value).trim());
  }

  const { data } = await api.post(`/admin/${props.token}/question-packages/import`, form)
    .catch(e => ({ data: { error: e?.response?.data?.error || "error" } }));
  importBusy.value = false;

  if (data?.ok) {
    showToast(`Import successful (${data.imported || 0} questions).`, "success");
    importFile.value = null;
    importSaveTemplateName.value = "";
    if (importFileInput.value) importFileInput.value.value = "";
    await load();
    await loadPackages();
    return;
  }
  showToast(questionErrorText(data?.error), "error");
}

async function saveWinTexts() {
  const { data } = await api.post(`/admin/${props.token}/wintexts`, {
    guestWinText: guestWinText.value,
    playerWinText: playerWinText.value,
    tieWinText: tieWinText.value
  }).catch(e => ({ data: { error: e?.response?.data?.error || "error" } }));
  if (data?.ok) {
    showToast("Winner texts saved.", "success");
    await load();
  } else {
    showToast(`Error: ${data?.error || "error"}`, "error");
  }
}

function resetForm() {
  qText.value = "";
  qType.value = "choice";
  qBlockLabel.value = "General";
  allowMultiple.value = false;
  promptMedia.value = "";
  promptMediaKind.value = "";
  promptImage.value = "";
  promptAudio.value = "";
  promptVideo.value = "";
  estimateTarget.value = "";
  estimateTolerance.value = "0";
  solutionType.value = "none";
  solutionText.value = "";
  solutionMedia.value = "";
  solutionMediaKind.value = "";
  solutionImage.value = "";
  solutionAudio.value = "";
  solutionVideo.value = "";
  guestCorrectThresholdPercent.value = 50;
  options.value = [
    { text: "", image: "", isCorrect: false },
    { text: "", image: "", isCorrect: false },
    { text: "", image: "", isCorrect: false },
    { text: "", image: "", isCorrect: false }
  ];
  editingId.value = null;
  resetQuestionFieldTouched();
}

function addOption() {
  options.value.push({ text: "", image: "", isCorrect: false });
  touchQuestionField("options");
}

function removeOption(i) {
  if (options.value.length <= 2) return;
  options.value.splice(i, 1);
  touchQuestionField("options");
}

function moveOption(index, delta) {
  const target = index + delta;
  if (target < 0 || target >= options.value.length) return;
  const arr = [...options.value];
  const [item] = arr.splice(index, 1);
  arr.splice(target, 0, item);
  options.value = arr;
}

async function saveQuestion() {
  touchAllQuestionFields();
  if (!isQuestionFormValid.value) {
    showToast("Please check the marked fields.", "error");
    return;
  }

  const dataUrlRefs = [
    { key: "promptMedia", value: promptMedia.value },
    { key: "solutionMedia", value: solutionMedia.value },
    ...options.value.map((o, idx) => ({ key: `optionImage${idx}`, value: o?.image }))
  ];
  if (dataUrlRefs.some(x => String(x.value || "").trim().startsWith("data:"))) {
    showToast("Please save media via file upload or URL, not as data URL.", "error");
    return;
  }

  const normalizedSolutionText = String(solutionText.value || "").trim();
  const normalizedPromptMedia = String(promptMedia.value || "").trim();
  const normalizedSolutionMedia = String(solutionMedia.value || "").trim();

  if (solutionType.value === "none") {
    solutionText.value = "";
    setSolutionMedia("");
  } else if (solutionType.value === "text") {
    setSolutionMedia("");
  } else if (solutionType.value === "image") {
    solutionText.value = "";
    setSolutionMedia(normalizedSolutionMedia, solutionMediaKind.value);
  } else if (solutionType.value === "both") {
    solutionText.value = normalizedSolutionText;
    setSolutionMedia(normalizedSolutionMedia, solutionMediaKind.value);
  }

  setPromptMedia(normalizedPromptMedia, promptMediaKind.value);

  const wasEdit = !!editingId.value;
  const payload = {
    text: qText.value,
    type: qType.value,
    blockLabel: qBlockLabel.value,
    allowMultiple: allowMultiple.value,
    promptMedia: promptMedia.value,
    promptImage: promptImage.value,
    promptAudio: promptAudio.value,
    promptVideo: promptVideo.value,
    estimateTarget: estimateTarget.value,
    estimateTolerance: estimateTolerance.value,
    solutionType: solutionType.value,
    solutionText: solutionText.value,
    solutionMedia: (solutionType.value === "image" || solutionType.value === "both") ? solutionMedia.value : "",
    solutionImage: solutionImage.value,
    solutionAudio: solutionAudio.value,
    solutionVideo: solutionVideo.value,
    guestCorrectThresholdPercent: normalizeGuestThresholdPercent(guestCorrectThresholdPercent.value),
    options: options.value.map((o, idx) => ({
      text: o.text,
      image: o.image || "",
      isCorrect: o.isCorrect,
      orderIndex: idx
    }))
  };
  const { data } = await (editingId.value
    ? api.put(`/admin/${props.token}/questions/${editingId.value}`, payload)
    : api.post(`/admin/${props.token}/questions`, payload)
  ).catch(e => ({ data: { error: e?.response?.data?.error || "error" } }));
  if (data?.ok) {
    resetForm();
    await load();
    questionModalOpen.value = false;
    showToast(wasEdit ? "Question updated." : "Question saved.", "success");
  } else {
    showToast(questionErrorText(data?.error), "error");
  }
}

function beginEdit(q) {
  editingId.value = q.id;
  qText.value = q.text || "";
  const rawType = String(q.type || "choice");
  qType.value = ["image_identity", "audio_identity", "video_identity", "media_identity"].includes(rawType) ? "choice" : rawType;
  qBlockLabel.value = normalizeBlockLabel(q.blockLabel);
  allowMultiple.value = !!q.allowMultiple;
  const promptMediaUrl = q.promptVideo || q.promptAudio || q.promptImage || "";
  const promptMediaType = q.promptVideo ? "video" : q.promptAudio ? "audio" : q.promptImage ? "image" : "";
  setPromptMedia(promptMediaUrl, promptMediaType);
  estimateTarget.value = q.estimateTarget !== null && q.estimateTarget !== undefined ? String(q.estimateTarget) : "";
  estimateTolerance.value = q.estimateTolerance !== null && q.estimateTolerance !== undefined ? String(q.estimateTolerance) : "0";
  solutionText.value = q.solutionText || "";
  const solutionMediaUrl = q.solutionVideo || q.solutionAudio || q.solutionImage || "";
  const solutionMediaType = q.solutionVideo ? "video" : q.solutionAudio ? "audio" : q.solutionImage ? "image" : "";
  setSolutionMedia(solutionMediaUrl, solutionMediaType);
  const hasSolutionText = !!String(solutionText.value || "").trim();
  const hasSolutionMedia = !!String(solutionMedia.value || "").trim();
  guestCorrectThresholdPercent.value = normalizeGuestThresholdPercent(q.guestCorrectThresholdPercent);
  if (hasSolutionText && hasSolutionMedia) solutionType.value = "both";
  else if (hasSolutionText) solutionType.value = "text";
  else if (hasSolutionMedia) solutionType.value = "image";
  else solutionType.value = "none";
  options.value = (q.Options || [])
    .slice()
    .sort((a, b) => Number(a.orderIndex || 0) - Number(b.orderIndex || 0) || Number(a.id || 0) - Number(b.id || 0))
    .map(o => ({ text: o.text, image: o.image || "", isCorrect: !!o.isCorrect }));
  if (options.value.length < 2) {
    options.value.push({ text: "", image: "", isCorrect: false });
    options.value.push({ text: "", image: "", isCorrect: false });
  }
}

function openCreateQuestionModal() {
  resetForm();
  questionModalOpen.value = true;
}

function openEditQuestionModal(q) {
  beginEdit(q);
  questionModalOpen.value = true;
}

function closeQuestionModal() {
  closeFullscreenImage();
  questionModalOpen.value = false;
  cancelEdit();
}

function cancelEdit() {
  resetForm();
}

async function uploadMediaFile(file, kind) {
  if (!file) return "";
  const form = new FormData();
  form.append("file", file);
  form.append("kind", kind);
  const { data } = await api.post(`/admin/${props.token}/media`, form)
    .catch(e => ({ data: { error: e?.response?.data?.error || "upload_failed" } }));
  if (data?.url) {
    return {
      url: String(data.url),
      medium: String(data.medium || inferMediumFromRef(data.url) || "")
    };
  }
  throw new Error(String(data?.error || "upload_failed"));
}

function onPromptMediaInput() {
  setPromptMedia(promptMedia.value);
}

function onSolutionMediaInput() {
  setSolutionMedia(solutionMedia.value);
}

function onOptionImageInput(index) {
  const i = Number(index);
  if (!Number.isFinite(i) || i < 0 || i >= options.value.length) return;
  const value = String(options.value[i]?.image || "").trim();
  if (!value) return;
  const medium = inferMediumFromRef(value);
  if (medium && medium !== "image") {
    options.value[i].image = "";
    showToast("Option image must be an image URL/file.", "error");
  }
}

async function onPromptMediaFile(evt) {
  const file = evt?.target?.files?.[0];
  if (!file) return;
  try {
    const result = await uploadMediaFile(file, "prompt_media");
    setPromptMedia(result.url, result.medium);
    touchQuestionField("promptMedia");
  } catch (err) {
    showToast(questionErrorText(err?.message), "error");
  } finally {
    if (evt?.target) evt.target.value = "";
  }
}

async function onSolutionMediaFile(evt) {
  const file = evt?.target?.files?.[0];
  if (!file) return;
  try {
    const result = await uploadMediaFile(file, "solution_media");
    setSolutionMedia(result.url, result.medium);
    solutionType.value = solutionType.value === "text" ? "both" : "image";
    touchQuestionField("solutionMedia");
  } catch (err) {
    showToast(questionErrorText(err?.message), "error");
  } finally {
    if (evt?.target) evt.target.value = "";
  }
}

async function onOptionImageFile(evt, index) {
  const file = evt?.target?.files?.[0];
  const i = Number(index);
  if (!file || !Number.isFinite(i) || i < 0 || i >= options.value.length) return;
  try {
    const result = await uploadMediaFile(file, "option_image");
    options.value[i].image = result.url;
    touchQuestionField("options");
  } catch (err) {
    showToast(questionErrorText(err?.message), "error");
  } finally {
    if (evt?.target) evt.target.value = "";
  }
}

async function deleteQuestion(q) {
  if (!confirm("Delete question?")) return;
  const { data } = await api.delete(`/admin/${props.token}/questions/${q.id}`)
    .catch(e => ({ data: { error: e?.response?.data?.error || "error" } }));
  if (data?.ok) {
    if (editingId.value === q.id) resetForm();
    await load();
    showToast("Question deleted.", "success");
  } else {
    showToast(`Error: ${data?.error || "error"}`, "error");
  }
}

function addBlock() {
  const label = normalizeBlockLabel(newBlockLabel.value);
  if (!blockOptions.value.includes(label)) {
    manualBlocks.value = [...manualBlocks.value, label];
    showToast(`Block "${label}" added.`, "success");
  }
  newBlockLabel.value = "";
}

function setQuestionBlock(questionId, blockLabel) {
  const normalized = normalizeBlockLabel(blockLabel);
  const idx = questions.value.findIndex(q => q.id === questionId);
  if (idx < 0) return;
  if (questions.value[idx].blockLabel === normalized) return;
  const arr = [...questions.value];
  arr[idx] = { ...arr[idx], blockLabel: normalized };
  questions.value = arr;
  orderDirty.value = true;
}

function startQuestionPointer(evt, questionId) {
  draggingQuestionId.value = questionId;
  questionDropIndex.value = questions.value.findIndex(q => q.id === questionId);
  if (evt?.currentTarget?.setPointerCapture && evt?.pointerId !== undefined) {
    try { evt.currentTarget.setPointerCapture(evt.pointerId); } catch {}
  }
  window.addEventListener("pointermove", onQuestionPointerMove, { passive: false });
  window.addEventListener("pointerup", onQuestionPointerUp, { passive: false });
  window.addEventListener("pointercancel", onQuestionPointerUp, { passive: false });
}

function onQuestionCardPointerDown(evt, questionId) {
  if (draggingQuestionId.value) return;
  const interactive = evt?.target?.closest?.("button,select,input,textarea,a,label");
  if (interactive) return;
  startQuestionPointer(evt, questionId);
}

function onQuestionPointerMove(evt) {
  if (!draggingQuestionId.value) return;
  if (evt?.cancelable) evt.preventDefault();
  const target = document.elementFromPoint(evt.clientX, evt.clientY);
  if (!target) return;

  const endZone = target.closest?.("[data-question-end='1']");
  if (endZone) {
    questionDropIndex.value = questions.value.length;
    return;
  }

  const item = target.closest?.("[data-question-id]");
  if (!item) return;
  const targetId = Number(item.getAttribute("data-question-id"));
  const targetIndex = questions.value.findIndex(q => q.id === targetId);
  if (targetIndex < 0) return;
  const rect = item.getBoundingClientRect();
  const insertAfter = evt.clientY > rect.top + rect.height / 2;
  questionDropIndex.value = insertAfter ? targetIndex + 1 : targetIndex;
}

function onQuestionPointerUp(evt) {
  if (evt?.cancelable) evt.preventDefault();
  if (draggingQuestionId.value) finalizeQuestionDrag();
  window.removeEventListener("pointermove", onQuestionPointerMove);
  window.removeEventListener("pointerup", onQuestionPointerUp);
  window.removeEventListener("pointercancel", onQuestionPointerUp);
}

function finalizeQuestionDrag() {
  const dragId = draggingQuestionId.value;
  if (!dragId) return;
  const dragged = questions.value.find(q => q.id === dragId);
  if (!dragged) {
    draggingQuestionId.value = null;
    questionDropIndex.value = null;
    return;
  }
  const idxRaw = Number(questionDropIndex.value);
  let idx = Number.isFinite(idxRaw) ? Math.max(0, Math.min(questions.value.length, idxRaw)) : questions.value.length;
  const fromIndex = questions.value.findIndex(q => q.id === dragId);
  const arr = [...questions.value];
  arr.splice(fromIndex, 1);
  if (idx > fromIndex) idx -= 1;
  idx = Math.max(0, Math.min(arr.length, idx));
  arr.splice(idx, 0, dragged);
  questions.value = arr;
  orderDirty.value = true;
  draggingQuestionId.value = null;
  questionDropIndex.value = null;
}

onBeforeUnmount(() => {
  window.removeEventListener("pointermove", onQuestionPointerMove);
  window.removeEventListener("pointerup", onQuestionPointerUp);
  window.removeEventListener("pointercancel", onQuestionPointerUp);
  window.removeEventListener("pointermove", onOptionPointerMove);
  window.removeEventListener("pointerup", onOptionPointerUp);
  window.removeEventListener("pointercancel", onOptionPointerUp);
});

function startOptionPointer(evt, index) {
  if (qType.value !== "order") return;
  draggingOptionIndex.value = index;
  if (evt?.currentTarget?.setPointerCapture && evt?.pointerId !== undefined) {
    try { evt.currentTarget.setPointerCapture(evt.pointerId); } catch {}
  }
  window.addEventListener("pointermove", onOptionPointerMove, { passive: false });
  window.addEventListener("pointerup", onOptionPointerUp, { passive: false });
  window.addEventListener("pointercancel", onOptionPointerUp, { passive: false });
}

function hoverOption(targetIndex) {
  if (qType.value !== "order") return;
  const fromIndex = draggingOptionIndex.value;
  if (fromIndex === null || fromIndex === undefined) return;
  if (fromIndex === targetIndex) return;
  const arr = [...options.value];
  const [item] = arr.splice(fromIndex, 1);
  arr.splice(targetIndex, 0, item);
  options.value = arr;
  draggingOptionIndex.value = targetIndex;
}

function onOptionPointerMove(evt) {
  if (qType.value !== "order") return;
  const fromIndex = draggingOptionIndex.value;
  if (fromIndex === null || fromIndex === undefined) return;
  if (evt?.cancelable) evt.preventDefault();

  const target = document.elementFromPoint(evt.clientX, evt.clientY);
  if (!target) return;
  const row = target.closest?.("[data-edit-order-index]");
  if (!row) return;
  const targetIndex = Number(row.getAttribute("data-edit-order-index"));
  if (!Number.isFinite(targetIndex)) return;
  hoverOption(targetIndex);
}

function onOptionPointerUp(evt) {
  if (evt?.cancelable) evt.preventDefault();
  draggingOptionIndex.value = null;
  window.removeEventListener("pointermove", onOptionPointerMove);
  window.removeEventListener("pointerup", onOptionPointerUp);
  window.removeEventListener("pointercancel", onOptionPointerUp);
}

async function saveQuestionOrder() {
  const items = questions.value.map((q, idx) => ({
    id: q.id,
    sortOrder: idx,
    blockLabel: normalizeBlockLabel(q.blockLabel)
  }));
  const { data } = await api.post(`/admin/${props.token}/questions/reorder`, { items })
    .catch(e => ({ data: { error: e?.response?.data?.error || "error" } }));
  if (data?.ok) {
    showToast("Order saved.", "success");
    await load();
  } else {
    showToast(`Error: ${data?.error || "error"}`, "error");
  }
}

async function savePublish() {
  autoRevealDelaySeconds.value = normalizeAutoRevealDelaySeconds(autoRevealDelaySeconds.value);
  const { data } = await api.post(`/admin/${props.token}/publish`, {
    isPublished: isPublished.value,
    showScore: showScore.value,
    showQuizTitle: showQuizTitle.value,
    autoRevealEnabled: autoRevealEnabled.value,
    autoRevealDelaySeconds: autoRevealDelaySeconds.value,
    uiLanguage: uiLanguage.value || "en"
  }).catch(e => ({ data: { error: e?.response?.data?.error || "error" } }));
  if (data?.ok) {
    showToast("Game configuration saved.", "success");
    await load();
  } else {
    showToast(`Error: ${data?.error || "error"}`, "error");
  }
}

async function clearAllGuests() {
  if (!confirm("Delete ALL guests and answers? (Questions remain)")) return;
  const { data } = await api.post(`/admin/${props.token}/clear_all`).catch(e => ({ data: { error: e?.response?.data?.error || "error" } }));
  if (!data?.ok) {
    showToast(`Error: ${data?.error || "error"}`, "error");
  } else {
    showToast("All guests and answers deleted.", "success");
  }
  resetForm();
  await load();
}

async function savePlayerName() {
  const { data } = await api.post(`/admin/${props.token}/player`, { playerName: playerName.value }).catch(e => ({ data: { error: e?.response?.data?.error || "error" } }));
  if (data?.ok) {
    showToast("Player name saved.", "success");
    await load();
  } else {
    showToast(`Error: ${data?.error || "error"}`, "error");
  }
}

async function startLive() {
  await api.post(`/admin/${props.token}/start`);
  await load();
}

function setupSocket() {
  try {
    socket.emit("join_game", { token: props.token });
    socket.on("game_state", (s) => {
      game.value = s.game;
      score.value = s.score ? { ...s.score, rankings: s.score.rankings ? [...s.score.rankings] : [] } : null;
      if (s?.player?.nickname) playerName.value = s.player.nickname;
      isPublished.value = !!s.game?.isPublished;
      showScore.value = s.game?.showScore !== false;
      showQuizTitle.value = s.game?.showQuizTitle !== false;
      autoRevealEnabled.value = s.game?.autoRevealEnabled !== false;
      autoRevealDelaySeconds.value = normalizeAutoRevealDelaySeconds(s.game?.autoRevealDelaySeconds);
      uiLanguage.value = String(s.game?.uiLanguage || "en");
      setLanguage(uiLanguage.value).catch(() => {});
    });

    socket.on("answer_received", async () => {
      try {
        const { data } = await api.get(`/state/${props.token}`);
        score.value = data.score ? { ...data.score, rankings: data.score.rankings ? [...data.score.rankings] : [] } : null;
        game.value = data.game;
        isPublished.value = !!data.game?.isPublished;
        showScore.value = data.game?.showScore !== false;
        showQuizTitle.value = data.game?.showQuizTitle !== false;
        autoRevealEnabled.value = data.game?.autoRevealEnabled !== false;
        autoRevealDelaySeconds.value = normalizeAutoRevealDelaySeconds(data.game?.autoRevealDelaySeconds);
        uiLanguage.value = String(data.game?.uiLanguage || "en");
        setLanguage(uiLanguage.value).catch(() => {});
      } catch {}
    });
  } catch {}
}

async function stopGame() {
  if (!confirm("Stop game? The pages will return to waiting mode.")) return;
  await api.post(`/admin/${props.token}/stop`);
  await load();
}

async function deleteGameFromEditor() {
  const title = String(game.value?.title || "this game");
  if (!confirm(`Delete game \"${title}\"? This action cannot be undone.`)) return;
  const { data } = await api.delete(`/admin/${props.token}`)
    .catch(e => ({ data: { error: e?.response?.data?.error || "error" } }));
  if (data?.ok) {
    router.push("/admin");
    return;
  }
  showToast(`Error: ${data?.error || "error"}`, "error");
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(String(text || ""));
    showToast("Link copied.", "success");
  } catch {
    showToast("Copy failed.", "error");
  }
}

function removeToast(id) {
  toasts.value = toasts.value.filter(t => t.id !== id);
}

function showToast(message, type = "info", timeoutMs = 2400) {
  const id = toastSeq++;
  toasts.value = [...toasts.value, { id, message: String(message || ""), type }];
  setTimeout(() => removeToast(id), timeoutMs);
}

function toastStyle(type) {
  if (type === "success") {
    return {
      display: "flex",
      gap: "12px",
      alignItems: "flex-start",
      justifyContent: "space-between",
      borderRadius: "12px",
      border: "1px solid #15803d",
      background: "#f0fdf4",
      color: "#14532d",
      padding: "10px 12px",
      boxShadow: "0 8px 20px rgba(0,0,0,0.12)"
    };
  }
  if (type === "error") {
    return {
      display: "flex",
      gap: "12px",
      alignItems: "flex-start",
      justifyContent: "space-between",
      borderRadius: "12px",
      border: "1px solid #e10011",
      background: "#fff1f2",
      color: "#7f1d1d",
      padding: "10px 12px",
      boxShadow: "0 8px 20px rgba(0,0,0,0.12)"
    };
  }
  return {
    display: "flex",
    gap: "12px",
    alignItems: "flex-start",
    justifyContent: "space-between",
    borderRadius: "12px",
    border: "1px solid #004e96",
    background: "#f0f7ff",
    color: "#003968",
    padding: "10px 12px",
    boxShadow: "0 8px 20px rgba(0,0,0,0.12)"
  };
}
</script>

<style scoped>
.admin-shell {
  color: #0f172a;
}

.admin-tabs {
  margin-top: 18px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.admin-tab {
  min-height: 46px;
  border: 1px solid #dbe2ea;
  border-radius: 12px;
  background: #fff;
  font-weight: 800;
  color: #334155;
}

.admin-tab.active {
  border-color: #004e96;
  background: #eaf3ff;
  color: #003968;
}

.admin-card {
  background: #fff;
  box-shadow: 0 4px 16px rgba(15, 23, 42, 0.05);
}

.import-step {
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 12px;
  margin-bottom: 10px;
  background: #fcfdff;
}

.import-step:last-child {
  margin-bottom: 0;
}

.import-step summary {
  cursor: pointer;
  font-weight: 800;
  color: #003968;
}

.import-step-body {
  margin-top: 10px;
  display: grid;
  gap: 10px;
}

.field-error {
  color: #b91c1c;
  font-size: 13px;
  font-weight: 700;
}

.input-invalid {
  border-color: #e10011 !important;
  background: #fff5f5 !important;
}

.clickable-image {
  cursor: zoom-in;
}

.image-viewer {
  position: fixed;
  inset: 0;
  z-index: 140;
  background: rgba(2, 6, 23, 0.92);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 14px;
}

.image-viewer-img {
  max-width: min(95vw, 1800px);
  max-height: 92vh;
  object-fit: contain;
  border-radius: 12px;
  background: #0f172a;
}

.image-viewer-close {
  position: fixed;
  top: 14px;
  right: 14px;
  width: 40px;
  height: 40px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  background: rgba(15, 23, 42, 0.72);
  color: #fff;
  font-size: 28px;
  line-height: 1;
  cursor: pointer;
}

@media (max-width: 840px) {
  .admin-tabs {
    grid-template-columns: 1fr;
  }
}
</style>
