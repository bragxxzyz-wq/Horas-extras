const DB_NAME = 'horas-extras'
const DB_VERSION = 3
const STORES = ['perfis', 'comprovantes']

let db = null
let perfilAtivoId = null
let stream = null
let capturedImage = null
let isAdmin = false

// ========== FIREBASE ==========
firebase.initializeApp(firebaseConfig)
const firestore = firebase.firestore()

// ========== CRYPTO ==========
async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function gerarCodigoAleatorio() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let r = ''
  for (let i = 0; i < 8; i++) r += chars[Math.floor(Math.random() * chars.length)]
  return r.slice(0, 4) + '-' + r.slice(4)
}

// ========== INDEXEDDB (perfis + comprovantes) ==========
function abrirDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (e) => {
      const d = e.target.result
      for (const s of STORES) {
        if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id', autoIncrement: true })
      }
    }
    req.onsuccess = (e) => resolve(e.target.result)
    req.onerror = () => reject(req.error)
  })
}

function opDB(store, modo, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, modo)
    const s = tx.objectStore(store)
    const req = fn(s)
    tx.oncomplete = () => resolve(req.result)
    tx.onerror = () => reject(tx.error)
  })
}

// ========== CONFIG (Firestore) ==========
async function getConfig() {
  const doc = await firestore.collection('config').doc('admin').get()
  return doc.exists ? doc.data() : null
}

async function saveConfig(config) {
  await firestore.collection('config').doc('admin').set(config)
}

// ========== CONVITES (Firestore) ==========
async function listarConvites() {
  const snap = await firestore.collection('convites').orderBy('createdAt', 'desc').get()
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

async function salvarConvite(c) {
  const ref = await firestore.collection('convites').add(c)
  return ref.id
}

async function atualizarConvite(id, data) {
  await firestore.collection('convites').doc(id).update(data)
}

// ========== PERFIS (IndexedDB) ==========
async function listarPerfis() { return opDB('perfis', 'readonly', s => s.getAll()) }
async function salvarPerfil(p) { return p.id ? opDB('perfis', 'readwrite', s => s.put(p)) : opDB('perfis', 'readwrite', s => s.add(p)) }
async function deletarPerfil(id) { return opDB('perfis', 'readwrite', s => s.delete(id)) }
async function getPerfil(id) { return opDB('perfis', 'readonly', s => s.get(id)) }

// ========== COMPROVANTES (IndexedDB) ==========
async function salvarComprovante(d) { return opDB('comprovantes', 'readwrite', s => s.add(d)) }
async function listarComprovantes() { const r = await opDB('comprovantes', 'readonly', s => s.getAll()); return r.reverse() }
async function deletarComprovante(id) { return opDB('comprovantes', 'readwrite', s => s.delete(id)) }

// ========== LOGIN ==========
const telaLogin = document.getElementById('tela-login')
const appContainer = document.getElementById('app-container')

function mostrarApp() {
  telaLogin.classList.add('hidden')
  appContainer.classList.remove('hidden')
}

function mostrarLogin() {
  telaLogin.classList.remove('hidden')
  appContainer.classList.add('hidden')
}

async function initLogin() {
  const config = await getConfig()

  if (!config || !config.passwordHash) {
    document.getElementById('login-setup').classList.remove('hidden')
    document.getElementById('login-entrar').classList.add('hidden')
  } else {
    document.getElementById('login-setup').classList.add('hidden')
    document.getElementById('login-entrar').classList.remove('hidden')
  }
}

document.getElementById('btn-setup').addEventListener('click', async () => {
  const senha = document.getElementById('setup-senha').value
  const confirmar = document.getElementById('setup-confirmar').value
  const erro = document.getElementById('login-msg-erro')

  if (!senha || senha.length < 4) { erro.textContent = 'A senha deve ter no mínimo 4 caracteres.'; erro.classList.remove('hidden'); return }
  if (senha !== confirmar) { erro.textContent = 'As senhas não conferem.'; erro.classList.remove('hidden'); return }

  const hash = await sha256(senha)
  await saveConfig({ passwordHash: hash, createdAt: new Date().toISOString() })

  erro.classList.add('hidden')
  isAdmin = true
  mostrarApp()
  initApp()
})

document.getElementById('login-aba-admin').addEventListener('click', () => {
  document.querySelectorAll('.login-aba-btn').forEach(b => b.classList.remove('ativo'))
  document.getElementById('login-aba-admin').classList.add('ativo')
  document.getElementById('login-form-admin').classList.remove('hidden')
  document.getElementById('login-form-convite').classList.add('hidden')
})

document.getElementById('login-aba-convite').addEventListener('click', () => {
  document.querySelectorAll('.login-aba-btn').forEach(b => b.classList.remove('ativo'))
  document.getElementById('login-aba-convite').classList.add('ativo')
  document.getElementById('login-form-admin').classList.add('hidden')
  document.getElementById('login-form-convite').classList.remove('hidden')
})

document.getElementById('btn-login-admin').addEventListener('click', async () => {
  const senha = document.getElementById('login-senha-admin').value
  const config = await getConfig()
  const erro = document.getElementById('login-msg-erro')

  if (!config || !config.passwordHash) { erro.textContent = 'Nenhum admin configurado.'; erro.classList.remove('hidden'); return }

  const hash = await sha256(senha)
  if (hash !== config.passwordHash) {
    erro.textContent = 'Senha incorreta.'; erro.classList.remove('hidden'); return
  }

  erro.classList.add('hidden')
  isAdmin = true
  mostrarApp()
  initApp()
})

document.getElementById('btn-login-convite').addEventListener('click', async () => {
  const codigo = document.getElementById('login-codigo-convite').value.trim().toUpperCase()
  const erro = document.getElementById('login-msg-erro')

  const snap = await firestore.collection('convites')
    .where('codigo', '==', codigo)
    .where('revogado', '==', false)
    .get()

  if (snap.empty) {
    erro.textContent = 'Código inválido ou já revogado.'; erro.classList.remove('hidden'); return
  }

  erro.classList.add('hidden')
  isAdmin = false
  mostrarApp()
  initApp()
})

document.getElementById('login-senha-admin').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('btn-login-admin').click() })
document.getElementById('login-codigo-convite').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('btn-login-convite').click() })
document.getElementById('setup-senha').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('btn-setup').click() })
document.getElementById('setup-confirmar').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('btn-setup').click() })

// ========== ADMIN PANEL ==========
async function renderAdmin() {
  document.getElementById('admin-autorizado').classList.toggle('hidden', !isAdmin)
  document.getElementById('admin-negado').classList.toggle('hidden', isAdmin)
  if (!isAdmin) return

  const convites = await listarConvites()
  const lista = document.getElementById('lista-codigos')
  const vazia = document.getElementById('sem-codigos')

  if (convites.length === 0) {
    lista.innerHTML = ''
    vazia.classList.remove('hidden')
  } else {
    vazia.classList.add('hidden')
    lista.innerHTML = convites.map(c => `
      <div class="codigo-item">
        <div>
          <div class="cod ${c.revogado ? 'status revogado' : ''}">${c.codigo}</div>
          <div class="data">${new Date(c.createdAt).toLocaleString('pt-BR')}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="status ${c.revogado ? 'revogado' : 'ativo'}">${c.revogado ? 'Revogado' : 'Ativo'}</span>
          ${c.revogado ? '' : `<button class="btn-revogar" data-id="${c.id}">Revogar</button>`}
        </div>
      </div>
    `).join('')

    lista.querySelectorAll('.btn-revogar').forEach(b => {
      b.addEventListener('click', async () => {
        if (confirm('Revogar este código?')) {
          await atualizarConvite(b.dataset.id, { revogado: true })
          renderAdmin()
        }
      })
    })
  }
}

document.getElementById('btn-gerar-codigo').addEventListener('click', async () => {
  if (!isAdmin) return
  const codigo = gerarCodigoAleatorio()
  await salvarConvite({ codigo, revogado: false, createdAt: new Date().toISOString() })

  document.getElementById('codigo-gerado').textContent = codigo
  document.getElementById('codigo-novo').classList.remove('hidden')
  renderAdmin()
})

document.getElementById('btn-copiar-codigo').addEventListener('click', () => {
  const text = document.getElementById('codigo-gerado').textContent
  navigator.clipboard.writeText(text).catch(() => {})
  document.getElementById('btn-copiar-codigo').textContent = 'Copiado!'
  setTimeout(() => { document.getElementById('btn-copiar-codigo').textContent = 'Copiar' }, 2000)
})

document.getElementById('btn-fechar-codigo').addEventListener('click', () => {
  document.getElementById('codigo-novo').classList.add('hidden')
})

document.getElementById('btn-mudar-senha').addEventListener('click', () => {
  if (!isAdmin) return
  document.getElementById('modal-senha').classList.remove('hidden')
})

document.getElementById('btn-cancelar-senha').addEventListener('click', () => {
  document.getElementById('modal-senha').classList.add('hidden')
})

document.getElementById('form-senha').addEventListener('submit', async (e) => {
  e.preventDefault()
  if (!isAdmin) return

  const atual = document.getElementById('senha-atual').value
  const nova = document.getElementById('senha-nova').value
  const confirmar = document.getElementById('senha-confirmar').value
  const config = await getConfig()
  const hashAtual = await sha256(atual)

  if (hashAtual !== config.passwordHash) { alert('Senha atual incorreta.'); return }
  if (nova.length < 4) { alert('A nova senha deve ter no mínimo 4 caracteres.'); return }
  if (nova !== confirmar) { alert('As senhas não conferem.'); return }

  await saveConfig({ ...config, passwordHash: await sha256(nova) })
  document.getElementById('modal-senha').classList.add('hidden')
  alert('Senha alterada com sucesso!')
})

// ========== NAVEGAÇÃO ==========
document.querySelectorAll('.nav button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav button').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'))
    document.getElementById('page-' + btn.dataset.page).classList.add('active')

    pararCamera()
    descartarCaptura()

    const page = btn.dataset.page
    if (page === 'admin') renderAdmin()
    else if (page === 'perfil') renderPerfis()
    else if (page === 'calcular') initCalculo()
    else if (page === 'camera') iniciarCamera()
    else if (page === 'galeria') renderGaleria()
  })
})

// ========== PERFIL ==========
async function renderPerfis() {
  const perfis = await listarPerfis()
  const ativo = document.getElementById('perfil-ativo')
  const sem = document.getElementById('sem-perfil')
  const lista = document.getElementById('lista-perfis')

  const perfilAtivo = perfis.find(p => p.id === perfilAtivoId) || perfis[0]
  if (perfilAtivo) perfilAtivoId = perfilAtivo.id
  if (perfilAtivoId) localStorage.setItem('perfilAtivoId', perfilAtivoId)

  if (perfis.length === 0) {
    ativo.classList.add('hidden'); sem.classList.remove('hidden'); lista.innerHTML = ''; return
  }

  sem.classList.add('hidden'); ativo.classList.remove('hidden')
  document.getElementById('perfil-foto').src = perfilAtivo.foto || ''
  document.getElementById('perfil-nome').textContent = perfilAtivo.nome
  document.getElementById('perfil-salario').textContent = `R$ ${Number(perfilAtivo.salario).toFixed(2)} · ${perfilAtivo.jornada}h/mês`
  document.getElementById('btn-editar-perfil').onclick = () => abrirModalPerfil(perfilAtivo)

  lista.innerHTML = perfis.map(p => {
    const ativa = p.id === perfilAtivoId
    return `
      <div class="perfil-item ${ativa ? 'ativo' : ''}" data-id="${p.id}">
        <img src="${p.foto || ''}" alt="">
        <div class="info">
          <strong>${p.nome}</strong>
          <span>R$ ${Number(p.salario).toFixed(2)} · 50%: ${p.taxa50}x · 100%: ${p.taxa100}x · Not: ${p.taxaNot}x</span>
        </div>
        <div class="acoes">
          ${ativa ? '' : `<button class="btn-select" data-id="${p.id}">Usar</button>`}
          <button class="btn-del" data-id="${p.id}">🗑</button>
        </div>
      </div>
    `
  }).join('')

  lista.querySelectorAll('.btn-select').forEach(b => {
    b.addEventListener('click', (e) => {
      e.stopPropagation()
      perfilAtivoId = parseInt(b.dataset.id)
      localStorage.setItem('perfilAtivoId', perfilAtivoId)
      renderPerfis()
    })
  })

  lista.querySelectorAll('.btn-del').forEach(b => {
    b.addEventListener('click', async (e) => {
      e.stopPropagation()
      const id = parseInt(b.dataset.id)
      if (confirm('Deletar este perfil?')) {
        await deletarPerfil(id)
        if (perfilAtivoId === id) perfilAtivoId = null
        renderPerfis()
      }
    })
  })

  lista.querySelectorAll('.perfil-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.acoes')) return
      const id = parseInt(item.dataset.id)
      if (id) abrirModalPerfil(perfis.find(p => p.id === id))
    })
  })
}

function abrirModalPerfil(perfil) {
  document.getElementById('modal-perfil-titulo').textContent = perfil ? 'Editar Perfil' : 'Novo Perfil'
  document.getElementById('perfil-nome-input').value = perfil ? perfil.nome : ''
  document.getElementById('perfil-salario-input').value = perfil ? perfil.salario : ''
  document.getElementById('perfil-jornada-input').value = perfil ? perfil.jornada : 220
  document.getElementById('perfil-taxa50-input').value = perfil ? perfil.taxa50 : 1.5
  document.getElementById('perfil-taxa100-input').value = perfil ? perfil.taxa100 : 2.0
  document.getElementById('perfil-taxaNot-input').value = perfil ? perfil.taxaNot : 1.2
  document.getElementById('perfil-editando-id').value = perfil ? perfil.id : ''

  const preview = document.getElementById('perfil-foto-preview')
  if (perfil && perfil.foto) {
    preview.src = perfil.foto; preview.classList.remove('hidden')
    document.querySelector('.foto-placeholder').classList.add('hidden')
  } else {
    preview.classList.add('hidden')
    document.querySelector('.foto-placeholder').classList.remove('hidden')
  }

  document.getElementById('modal-perfil').classList.remove('hidden')
}

document.getElementById('btn-novo-perfil').addEventListener('click', () => abrirModalPerfil(null))
document.getElementById('btn-cancelar-perfil').addEventListener('click', () => document.getElementById('modal-perfil').classList.add('hidden'))

document.getElementById('perfil-foto-input').addEventListener('change', (e) => {
  const file = e.target.files[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = (ev) => {
    const preview = document.getElementById('perfil-foto-preview')
    preview.src = ev.target.result; preview.classList.remove('hidden')
    document.querySelector('.foto-placeholder').classList.add('hidden')
  }
  reader.readAsDataURL(file)
})

document.getElementById('foto-upload-area').addEventListener('click', () => document.getElementById('perfil-foto-input').click())

document.getElementById('form-perfil').addEventListener('submit', async (e) => {
  e.preventDefault()
  const editandoId = document.getElementById('perfil-editando-id').value
  const fotoPreview = document.getElementById('perfil-foto-preview')
  const fotoSrc = fotoPreview.classList.contains('hidden') ? null : fotoPreview.src

  const perfil = {
    nome: document.getElementById('perfil-nome-input').value.trim(),
    foto: fotoSrc,
    salario: parseFloat(document.getElementById('perfil-salario-input').value),
    jornada: parseFloat(document.getElementById('perfil-jornada-input').value),
    taxa50: parseFloat(document.getElementById('perfil-taxa50-input').value),
    taxa100: parseFloat(document.getElementById('perfil-taxa100-input').value),
    taxaNot: parseFloat(document.getElementById('perfil-taxaNot-input').value),
  }
  if (editandoId) perfil.id = parseInt(editandoId)

  const id = await salvarPerfil(perfil)
  if (!perfilAtivoId) { perfilAtivoId = perfil.id || id; localStorage.setItem('perfilAtivoId', perfilAtivoId) }

  document.getElementById('modal-perfil').classList.add('hidden')
  renderPerfis()
})

// ========== CÁLCULO ==========
async function initCalculo() {
  const perfis = await listarPerfis()
  const semPerfil = document.getElementById('calc-sem-perfil')
  const comPerfil = document.getElementById('calc-com-perfil')
  const resultado = document.getElementById('resultado')
  resultado.classList.add('hidden')

  if (perfis.length === 0 || !perfilAtivoId) {
    semPerfil.classList.remove('hidden'); comPerfil.classList.add('hidden'); return
  }

  const perfil = await getPerfil(perfilAtivoId)
  if (!perfil) { semPerfil.classList.remove('hidden'); comPerfil.classList.add('hidden'); return }

  semPerfil.classList.add('hidden'); comPerfil.classList.remove('hidden')
  document.getElementById('calc-nome-perfil').textContent = perfil.nome
  document.getElementById('calc-salario').value = perfil.salario
  document.getElementById('calc-jornada').value = perfil.jornada
}

document.getElementById('form-calculo').addEventListener('submit', async (e) => {
  e.preventDefault()
  const perfil = await getPerfil(perfilAtivoId)
  if (!perfil) return

  const salario = parseFloat(document.getElementById('calc-salario').value)
  const jornada = parseFloat(document.getElementById('calc-jornada').value)
  const h50 = parseFloat(document.getElementById('calc-extra50').value) || 0
  const h100 = parseFloat(document.getElementById('calc-extra100').value) || 0
  const hNot = parseFloat(document.getElementById('calc-noturno').value) || 0

  const valorHora = salario / jornada
  const vExtra50 = valorHora * perfil.taxa50 * h50
  const vExtra100 = valorHora * perfil.taxa100 * h100
  const vNoturno = valorHora * perfil.taxaNot * hNot
  const total = vExtra50 + vExtra100 + vNoturno
  const pct50 = Math.round((perfil.taxa50 - 1) * 100)
  const pct100 = Math.round((perfil.taxa100 - 1) * 100)
  const pctNot = Math.round((perfil.taxaNot - 1) * 100)

  document.getElementById('resultado').innerHTML = `
    <h2>Resultado — ${perfil.nome}</h2>
    <div class="resultado-item"><span>Valor da hora</span><span>R$ ${valorHora.toFixed(2)}</span></div>
    <div class="resultado-item"><span>Extras ${pct50}% (${h50}h)</span><span>R$ ${vExtra50.toFixed(2)}</span></div>
    <div class="resultado-item"><span>Extras ${pct100}% (${h100}h)</span><span>R$ ${vExtra100.toFixed(2)}</span></div>
    <div class="resultado-item"><span>Ad. noturno ${pctNot}% (${hNot}h)</span><span>R$ ${vNoturno.toFixed(2)}</span></div>
    <div class="resultado-total"><span>Total a receber</span><span>R$ ${total.toFixed(2)}</span></div>
  `
  document.getElementById('resultado').classList.remove('hidden')
})

// ========== CÂMERA ==========
const video = document.getElementById('video')
const canvas = document.getElementById('canvas')
const btnCapturar = document.getElementById('btn-capturar')
const btnSalvar = document.getElementById('btn-salvar')
const btnDescartar = document.getElementById('btn-descartar')

async function iniciarCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 960 } },
      audio: false
    })
    video.srcObject = stream
  } catch (err) {
    alert('Não foi possível acessar a câmera: ' + err.message)
  }
}

function pararCamera() {
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null }
}

function descartarCaptura() {
  capturedImage = null
  canvas.classList.add('hidden'); video.classList.remove('hidden')
  btnCapturar.classList.remove('hidden'); btnSalvar.classList.add('hidden'); btnDescartar.classList.add('hidden')
}

btnCapturar.addEventListener('click', () => {
  canvas.width = video.videoWidth; canvas.height = video.videoHeight
  const ctx = canvas.getContext('2d')
  ctx.drawImage(video, 0, 0)
  capturedImage = canvas.toDataURL('image/jpeg', 0.9)
  canvas.classList.remove('hidden'); video.classList.add('hidden')
  btnCapturar.classList.add('hidden'); btnSalvar.classList.remove('hidden'); btnDescartar.classList.remove('hidden')
})

btnSalvar.addEventListener('click', async () => {
  if (!capturedImage) return
  await salvarComprovante({ dataUrl: capturedImage, data: new Date().toISOString() })
  descartarCaptura()
  alert('Comprovante salvo!')
})

btnDescartar.addEventListener('click', descartarCaptura)

// ========== GALERIA ==========
async function renderGaleria() {
  const container = document.getElementById('galeria')
  const vazia = document.getElementById('galeria-vazia')
  const fotos = await listarComprovantes()

  if (fotos.length === 0) {
    container.innerHTML = ''; vazia.classList.remove('hidden'); return
  }

  vazia.classList.add('hidden')
  container.innerHTML = fotos.map(f => `
    <div class="galeria-item">
      <img src="${f.dataUrl}" alt="Comprovante">
      <div class="info">${new Date(f.data).toLocaleString('pt-BR')}</div>
      <button class="delete" data-id="${f.id}">&times;</button>
    </div>
  `).join('')

  container.querySelectorAll('.delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (confirm('Deletar este comprovante?')) {
        await deletarComprovante(parseInt(btn.dataset.id))
        renderGaleria()
      }
    })
  })
}

// ========== INIT ==========
async function initApp() {
  const perfis = await listarPerfis()
  const salvo = localStorage.getItem('perfilAtivoId')
  if (salvo) perfilAtivoId = parseInt(salvo)
  if (perfilAtivoId && !perfis.find(p => p.id === perfilAtivoId)) perfilAtivoId = null
  if (!perfilAtivoId && perfis.length > 0) perfilAtivoId = perfis[0].id
  if (perfilAtivoId) localStorage.setItem('perfilAtivoId', perfilAtivoId)

  document.getElementById('page-perfil').classList.add('active')
  document.querySelector('[data-page="perfil"]').classList.add('active')
  renderPerfis()
}

;(async () => {
  db = await abrirDB()
  await initLogin()
})()
