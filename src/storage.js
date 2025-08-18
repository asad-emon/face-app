import localforage from 'localforage'

localforage.config({
  name: 'faceapp-web',
  storeName: 'gallery'
})

export async function saveImage(fileOrBlob, nameHint='image') {
  const id = `${Date.now()}_${Math.random().toString(36).slice(2,8)}`
  const key = `img_${id}`
  const blob = fileOrBlob instanceof Blob ? fileOrBlob : new Blob([fileOrBlob])
  const meta = { id: key, name: nameHint, createdAt: Date.now() }
  await localforage.setItem(key, { blob, meta })
  return meta
}

export async function listImages() {
  const items = []
  await localforage.iterate((value, key) => {
    if (key.startsWith('img_')) items.push(value.meta)
  })
  return items.sort((a,b)=>b.createdAt-a.createdAt)
}

export async function getImageBlob(id) {
  const item = await localforage.getItem(id)
  return item?.blob || null
}

export async function removeImage(id) {
  await localforage.removeItem(id)
}

export async function clearAll() {
  const keys = []
  await localforage.iterate((_, key)=>{ if (key.startsWith('img_')) keys.push(key) })
  await Promise.all(keys.map(k=>localforage.removeItem(k)))
}
