import { addHaters, blankViewer, type CustomCrowd, type CustomViewer, type ViewerRole } from '@shared/custom-viewers'

interface CustomApi {
  get(): Promise<CustomCrowd>
  set(crowd: CustomCrowd): Promise<CustomCrowd>
  exportFile(): Promise<boolean>
  importFile(): Promise<CustomCrowd>
}

const list = document.querySelector('#custom-list') as HTMLElement
const form = document.querySelector('#custom-form') as HTMLElement
const add = document.querySelector('#custom-add') as HTMLButtonElement
const haters = document.querySelector('#custom-haters') as HTMLButtonElement
const save = document.querySelector('#custom-save') as HTMLButtonElement
const remove = document.querySelector('#custom-delete') as HTMLButtonElement
const exportButton = document.querySelector('#custom-export') as HTMLButtonElement
const importButton = document.querySelector('#custom-import') as HTMLButtonElement
const randomNames = document.querySelector('#random-names') as HTMLTextAreaElement
const nameInput = document.querySelector('#cv-name') as HTMLInputElement
const roleInput = document.querySelector('#cv-role') as HTMLSelectElement
const colorInput = document.querySelector('#cv-color') as HTMLInputElement
const activeInput = document.querySelector('#cv-active') as HTMLInputElement
const descInput = document.querySelector('#cv-desc') as HTMLTextAreaElement
const phrasesInput = document.querySelector('#cv-phrases') as HTMLInputElement
const topicsInput = document.querySelector('#cv-topics') as HTMLInputElement

const sliders = {
  talkativeness: document.querySelector('#cv-talk') as HTMLInputElement,
  positivity: document.querySelector('#cv-pos') as HTMLInputElement,
  hype: document.querySelector('#cv-hype') as HTMLInputElement,
  trolling: document.querySelector('#cv-troll') as HTMLInputElement,
  presence: document.querySelector('#cv-presence') as HTMLInputElement,
  emoji: document.querySelector('#cv-emoji') as HTMLInputElement,
  caps: document.querySelector('#cv-caps') as HTMLInputElement,
  slang: document.querySelector('#cv-slang') as HTMLInputElement
}

let crowd: CustomCrowd = { viewers: [], randomNames: [] }
let editing = ''

function readViewer(id: string): CustomViewer {
  const current = crowd.viewers.find((viewer) => viewer.id === id) ?? blankViewer(id, nameInput.value || 'viewer')
  return {
    ...current,
    username: nameInput.value,
    role: roleInput.value as ViewerRole,
    color: colorInput.value,
    active: activeInput.checked,
    description: descInput.value,
    talkativeness: Number(sliders.talkativeness.value),
    positivity: Number(sliders.positivity.value),
    hype: Number(sliders.hype.value),
    trolling: Number(sliders.trolling.value),
    presence: Number(sliders.presence.value),
    emoji: Number(sliders.emoji.value),
    caps: Number(sliders.caps.value),
    slang: Number(sliders.slang.value),
    phrases: phrasesInput.value.split(','),
    topics: topicsInput.value.split(',')
  }
}

function show(viewer: CustomViewer | null): void {
  form.classList.toggle('hidden', !viewer)
  if (!viewer) return
  editing = viewer.id
  nameInput.value = viewer.username
  roleInput.value = viewer.role
  colorInput.value = viewer.color
  activeInput.checked = viewer.active
  descInput.value = viewer.description
  phrasesInput.value = viewer.phrases.join(', ')
  topicsInput.value = viewer.topics.join(', ')
  sliders.talkativeness.value = String(viewer.talkativeness)
  sliders.positivity.value = String(viewer.positivity)
  sliders.hype.value = String(viewer.hype)
  sliders.trolling.value = String(viewer.trolling)
  sliders.presence.value = String(viewer.presence)
  sliders.emoji.value = String(viewer.emoji)
  sliders.caps.value = String(viewer.caps)
  sliders.slang.value = String(viewer.slang)
}

function renderList(): void {
  list.replaceChildren(
    ...crowd.viewers.map((viewer) => {
      const row = document.createElement('div')
      row.className = 'viewer-row'
      const label = document.createElement('span')
      label.textContent = `${viewer.username} · ${viewer.role}${viewer.active ? '' : ' · off'}`
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = 'Edit'
      button.addEventListener('click', () => show(viewer))
      row.append(label, button)
      return row
    })
  )
  if (document.activeElement !== randomNames) randomNames.value = crowd.randomNames.join('\n')
}

export async function mountCustom(api: CustomApi): Promise<void> {
  crowd = await api.get()
  renderList()
  add.addEventListener('click', () => {
    const viewer = blankViewer(`cv-${Date.now()}`, 'new_viewer')
    crowd.viewers.push(viewer)
    renderList()
    show(viewer)
  })
  haters.addEventListener('click', () => {
    crowd = addHaters(crowd)
    renderList()
    void api.set(crowd).then((next) => {
      crowd = next
      renderList()
    })
  })
  save.addEventListener('click', () => {
    if (!editing) return
    const next = readViewer(editing)
    const index = crowd.viewers.findIndex((viewer) => viewer.id === editing)
    if (index >= 0) crowd.viewers[index] = next
    else crowd.viewers.push(next)
    void api.set(crowd).then((saved) => {
      crowd = saved
      renderList()
      const fresh = crowd.viewers.find((viewer) => viewer.id === editing) ?? crowd.viewers.at(-1) ?? null
      show(fresh)
    })
  })
  remove.addEventListener('click', () => {
    crowd.viewers = crowd.viewers.filter((viewer) => viewer.id !== editing)
    editing = ''
    show(null)
    void api.set(crowd).then((saved) => {
      crowd = saved
      renderList()
    })
  })
  let namesTimer = 0
  randomNames.addEventListener('input', () => {
    window.clearTimeout(namesTimer)
    namesTimer = window.setTimeout(() => {
      crowd.randomNames = randomNames.value.split(/\n+/).map((line) => line.trim()).filter(Boolean)
      void api.set(crowd).then((saved) => {
        crowd = saved
      })
    }, 300)
  })
  exportButton.addEventListener('click', () => {
    void api.set(crowd).then(() => api.exportFile())
  })
  importButton.addEventListener('click', () => {
    void api.importFile().then((saved) => {
      crowd = saved
      editing = ''
      show(null)
      renderList()
    })
  })
}
