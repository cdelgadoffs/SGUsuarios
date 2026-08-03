/* =========================================================
   CAPA DE PERSISTENCIA
========================================================= */
const STORAGE_DRIVER = 'localStorage';
const LS_KEY = 'streamingAppData';

const Storage = {
  async load() {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  },
  async save(data) {
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  }
};

/* =========================================================
   ESTADO
========================================================= */
let db = {
  servicios: [],
  usuarios: [],
  pagos: []
};
let vistaActual = 'dashboard';
let editandoServicioId = null;
let editandoUsuarioId = null;
let servicioSeleccionadoId = null;
let grupoInternoSeleccionadoId = null;
let sidebarGruposVisible = false;
let usuarioSeleccionadoId = null;
let historialPagosVisible = false;
let asignacionesTemp = [];
let asignacionEditIndex = null;

const main = document.getElementById('main');

function uid(prefix) { return prefix + '_' + Date.now() + '_' + Math.floor(Math.random() * 1000); }

function money(n) {
  n = Number(n) || 0;
  return '$' + n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

async function persist() {
  await Storage.save(db);
}

/* =========================================================
   CÁLCULOS DE NEGOCIO
========================================================= */
function periodoActual() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

function pagoRegistrado(usuarioId, servicioId, periodo) {
  return db.pagos.find(p => p.usuarioId === usuarioId && p.servicioId === servicioId && p.periodo === periodo);
}

function diasParaProximoPago(diaPago) {
  const hoy = new Date();
  let venc = new Date(hoy.getFullYear(), hoy.getMonth(), diaPago);
  if (venc < new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate())) {
    venc = new Date(hoy.getFullYear(), hoy.getMonth() + 1, diaPago);
  }
  return Math.round((venc - new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate())) / 86400000);
}

function totalCuentasServicio(servicio) {
  if (!servicio.gruposInternos) return 0;
  return servicio.gruposInternos.reduce((acc, g) => acc + (Number(g.cantidadCuentas) || 0), 0);
}

function costoTotalServicio(servicio) {
  const numGrupos = servicio.gruposInternos ? servicio.gruposInternos.length : 0;
  const costoMensual = Number(servicio.costoMensual) || 0;
  if (servicio.tipoGrupo === 'compartido') {
    return costoMensual;
  }
  return costoMensual * numGrupos;
}

function ingresoPorServicio(servicioId) {
  let total = 0;
  db.usuarios.forEach(u => {
    u.servicios.forEach(a => {
      if (a.servicioId === servicioId) total += Number(a.precio) || 0;
    });
  });
  return total;
}

function ingresoGrupo(servicioId, grupoId) {
  let total = 0;
  db.usuarios.forEach(u => {
    u.servicios.forEach(a => {
      if (a.servicioId === servicioId && a.grupoInternoId === grupoId) {
        total += Number(a.precio) || 0;
      }
    });
  });
  return total;
}

function costoGrupo(servicioId, grupoId) {
  const servicio = db.servicios.find(s => s.id === servicioId);
  if (!servicio) return 0;
  const numGrupos = servicio.gruposInternos ? servicio.gruposInternos.length : 0;
  if (numGrupos === 0) return 0;
  return (Number(servicio.costoMensual) || 0) / numGrupos;
}

function gananciaGrupo(servicioId, grupoId) {
  const servicio = db.servicios.find(s => s.id === servicioId);
  if (!servicio) return ingresoGrupo(servicioId, grupoId);
  const costoMensual = Number(servicio.costoMensual) || 0;
  let costoAtribuido = costoMensual;
  if (servicio.tipoGrupo === 'compartido') {
    const numGrupos = servicio.gruposInternos ? servicio.gruposInternos.length : 0;
    costoAtribuido = numGrupos > 0 ? costoMensual / numGrupos : 0;
  }
  return ingresoGrupo(servicioId, grupoId) - costoAtribuido;
}

function cuentasUsadasEnGrupo(servicioId, grupoId) {
  return db.usuarios.reduce((acc, u) => acc + u.servicios.filter(s => s.servicioId === servicioId && s.grupoInternoId === grupoId).length, 0);
}

function costoMensualTotal() {
  let total = 0;
  db.servicios.forEach(s => { total += costoTotalServicio(s); });
  return total;
}

function ingresoMensualTotal() {
  let total = 0;
  db.usuarios.forEach(u => u.servicios.forEach(s => total += Number(s.precio) || 0));
  return total;
}

function gananciaMensual() {
  return ingresoMensualTotal() - costoMensualTotal();
}

/* =========================================================
   NAVEGACIÓN
========================================================= */
document.querySelectorAll('#navMain .nav-item').forEach(el => {
  el.addEventListener('click', () => {
    vistaActual = el.dataset.vista;
    document.querySelectorAll('#navMain .nav-item').forEach(x => x.classList.remove('active'));
    el.classList.add('active');
    if (vistaActual !== 'servicios') {
      servicioSeleccionadoId = null;
      grupoInternoSeleccionadoId = null;
    }
    if (vistaActual !== 'usuarios') { usuarioSeleccionadoId = null; historialPagosVisible = false; }
    render();
  });
});

function render() {
  renderSidebars();
  if (vistaActual === 'dashboard') renderDashboard();
  else if (vistaActual === 'servicios') renderServicios();
  else if (vistaActual === 'usuarios') renderUsuarios();
  else if (vistaActual === 'pagos') renderPagos();
}

function irAUsuario(usuarioId) {
  vistaActual = 'usuarios';
  usuarioSeleccionadoId = usuarioId;
  document.querySelectorAll('#navMain .nav-item').forEach(x => x.classList.remove('active'));
  const navItem = document.querySelector('#navMain [data-vista="usuarios"]');
  if (navItem) navItem.classList.add('active');
  servicioSeleccionadoId = null;
  grupoInternoSeleccionadoId = null;
  sidebarGruposVisible = false;
  render();
}

/* =========================================================
   TOPBAR: fecha/hora
========================================================= */
function actualizarReloj() {
  const ahora = new Date();
  const fecha = ahora.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const hora = ahora.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  document.getElementById('topFecha').textContent = fecha;
  document.getElementById('topHora').textContent = hora;
}

/* =========================================================
   RENDER DE SIDEBARS
========================================================= */
function renderSidebars() {
  const sbServicios = document.getElementById('sidebarSecundario');
  const sbGrupos = document.getElementById('sidebarGrupos');
  const ssList = document.getElementById('ssList');
  const ssTitle = document.getElementById('ssTitle');
  const ssCount = document.getElementById('ssCount');
  const ssAddBtn = document.getElementById('ssAddBtn');

  if (vistaActual === 'servicios' || vistaActual === 'usuarios') {
    sbServicios.classList.remove('hidden');
  } else {
    sbServicios.classList.add('hidden');
  }

  const hayServicioSeleccionado = servicioSeleccionadoId !== null && db.servicios.some(s => s.id === servicioSeleccionadoId);
  if (vistaActual === 'servicios' && hayServicioSeleccionado && sidebarGruposVisible) {
    sbGrupos.classList.remove('hidden');
  } else {
    sbGrupos.classList.add('hidden');
  }

  const sbHistorial = document.getElementById('sidebarHistorial');
  const historialTrigger = document.getElementById('historialTrigger');

  if (vistaActual === 'servicios') {
    ssTitle.textContent = 'Servicios';
    ssCount.textContent = db.servicios.length + ' registrado(s)';
    ssAddBtn.disabled = false;
    ssAddBtn.onclick = () => abrirModalServicio(null);
    if (db.servicios.length === 0) {
      ssList.innerHTML = `<div class="ss-empty">Sin servicios. Usa "+" para crear el primero.</div>`;
    } else {
      if (!servicioSeleccionadoId || !db.servicios.some(s => s.id === servicioSeleccionadoId)) {
        servicioSeleccionadoId = db.servicios[0].id;
      }
      ssList.innerHTML = db.servicios.map(s => {
        const totalCuentas = totalCuentasServicio(s);
        const isActive = s.id === servicioSeleccionadoId;
        return `
          <div class="ss-item ${isActive ? 'active' : ''}" data-servicio="${s.id}">
            <div class="ss-item-title">${s.nombre}</div>
            <div class="ss-item-sub">${money(s.precioMensual)}/mes · ${totalCuentas} cuentas</div>
          </div>
        `;
      }).join('');
      ssList.querySelectorAll('[data-servicio]').forEach(el => {
        const servicioId = el.dataset.servicio;
        el.addEventListener('click', () => {
          servicioSeleccionadoId = servicioId;
          grupoInternoSeleccionadoId = null;
          sidebarGruposVisible = false;
          renderSidebars();
          renderServicios();
        });
        el.addEventListener('dblclick', () => {
          servicioSeleccionadoId = servicioId;
          sidebarGruposVisible = true;
          renderSidebars();
          renderServicios();
          const target = document.querySelector(`[data-servicio="${servicioId}"]`);
          if (target) {
            target.classList.add('ss-item-flash');
            setTimeout(() => target.classList.remove('ss-item-flash'), 500);
          }
        });
      });

      if (hayServicioSeleccionado) {
        renderGruposSidebar();
      }
    }
  } else if (vistaActual === 'usuarios') {
    ssTitle.textContent = 'Usuarios';
    ssCount.textContent = db.usuarios.length + ' registrado(s)';
    ssAddBtn.disabled = db.servicios.length === 0;
    ssAddBtn.onclick = () => abrirModalUsuario(null);
    if (db.usuarios.length === 0) {
      ssList.innerHTML = `<div class="ss-empty">${db.servicios.length === 0 ? 'Crea un servicio primero.' : 'Sin usuarios. Usa "+" para crear el primero.'}</div>`;
    } else {
      if (!usuarioSeleccionadoId || !db.usuarios.some(u => u.id === usuarioSeleccionadoId)) {
        usuarioSeleccionadoId = db.usuarios[0].id;
      }
      ssList.innerHTML = db.usuarios.map(u => `
        <div class="ss-item ${u.id === usuarioSeleccionadoId ? 'active' : ''}" data-sel="${u.id}">
          <div class="ss-item-title">${u.nombre}</div>
          <div class="ss-item-sub">Día ${u.diaPago} · ${u.servicios.length} servicio(s)</div>
        </div>
      `).join('');
      ssList.querySelectorAll('[data-sel]').forEach(el => el.addEventListener('click', () => {
        usuarioSeleccionadoId = el.dataset.sel;
        renderSidebars();
        renderUsuarios();
      }));
    }
  }

  const hayUsuarioSeleccionado = usuarioSeleccionadoId !== null && db.usuarios.some(u => u.id === usuarioSeleccionadoId);
  if (vistaActual !== 'usuarios' || !hayUsuarioSeleccionado) {
    historialPagosVisible = false;
  }
  if (vistaActual === 'usuarios' && hayUsuarioSeleccionado && historialPagosVisible) {
    sbHistorial.classList.remove('hidden');
    historialTrigger.classList.remove('visible');
  } else {
    sbHistorial.classList.add('hidden');
    if (vistaActual === 'usuarios' && hayUsuarioSeleccionado) {
      historialTrigger.classList.add('visible');
    } else {
      historialTrigger.classList.remove('visible');
    }
  }
}

function renderGruposSidebar() {
  const sgList = document.getElementById('sgList');
  const sgAddBtn = document.getElementById('sgAddBtn');
  sgAddBtn.onclick = () => agregarGrupoInternoAlServicio();

  const servicio = db.servicios.find(s => s.id === servicioSeleccionadoId);
  if (!servicio) {
    sgList.innerHTML = `<div class="sg-item" style="cursor:default;color:#999;font-size:12px;padding:12px 14px;">Selecciona un servicio</div>`;
    return;
  }

  const grupos = servicio.gruposInternos || [];
  if (grupos.length === 0) {
    sgList.innerHTML = `<div class="sg-item" style="cursor:default;color:#999;font-size:12px;padding:12px 14px;">Sin grupos</div>`;
    grupoInternoSeleccionadoId = null;
    return;
  }

  // Nota: NO reasignamos grupoInternoSeleccionadoId aquí si es null.
  // Solo se usa para resaltar visualmente si ya hay uno elegido; la decisión
  // de mostrar el panel general del servicio o el de un grupo específico
  // depende únicamente de una acción explícita del usuario (clic en un grupo
  // o en "Volver al servicio").
  if (grupoInternoSeleccionadoId && !grupos.some(g => g.id === grupoInternoSeleccionadoId)) {
    grupoInternoSeleccionadoId = null;
  }

  sgList.innerHTML = grupos.map(g => {
    const usadas = cuentasUsadasEnGrupo(servicio.id, g.id);
    return `
      <div class="sg-item ${g.id === grupoInternoSeleccionadoId ? 'active' : ''}" data-grupo="${g.id}">
        <div class="sg-item-title">${g.nombre}</div>
        <div class="sg-item-sub">${usadas}/${g.cantidadCuentas} cuentas</div>
      </div>
    `;
  }).join('');

  sgList.querySelectorAll('[data-grupo]').forEach(el => {
    el.addEventListener('click', () => {
      grupoInternoSeleccionadoId = el.dataset.grupo;
      renderSidebars();
      renderServicios();
    });
  });
}

function agregarGrupoInternoAlServicio() {
  const servicio = db.servicios.find(s => s.id === servicioSeleccionadoId);
  if (!servicio) return;
  if (!servicio.gruposInternos) servicio.gruposInternos = [];
  // Obtener la cantidad de cuentas por grupo del primer grupo existente, o 1
  const cuentasPorGrupo = servicio.gruposInternos.length > 0 ? servicio.gruposInternos[0].cantidadCuentas : 1;
  const n = servicio.gruposInternos.length + 1;
  servicio.gruposInternos.push({
    id: uid('gpo'),
    nombre: 'Grupo ' + n,
    cantidadCuentas: cuentasPorGrupo,
    campoGlobalValor: ''
  });
  persist().then(() => {
    renderSidebars();
    renderServicios();
    showToast('Grupo agregado.');
  });
}

/* =========================================================
   DASHBOARD
========================================================= */
function renderDashboard() {
  const periodo = periodoActual();
  let pagados = 0, pendientes = 0, vencidos = 0;
  const hoyDia = new Date().getDate();

  db.usuarios.forEach(u => {
    u.servicios.forEach(s => {
      const pago = pagoRegistrado(u.id, s.servicioId, periodo);
      if (pago) pagados++;
      else if (u.diaPago && hoyDia > Number(u.diaPago)) vencidos++;
      else pendientes++;
    });
  });

  const proximos = db.usuarios
    .map(u => ({ u, dias: diasParaProximoPago(Number(u.diaPago) || 1) }))
    .sort((a, b) => a.dias - b.dias)
    .slice(0, 6);

  main.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Panel administrativo</div>
        <div class="page-sub">Resumen general · ${new Date().toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })}</div>
      </div>
    </div>
    <div class="grid-cards">
      <div class="stat-card"><div class="n">${db.usuarios.length}</div><div class="l">Usuarios</div></div>
      <div class="stat-card"><div class="n">${db.servicios.length}</div><div class="l">Servicios</div></div>
      <div class="stat-card good"><div class="n">${money(ingresoMensualTotal())}</div><div class="l">Ingreso mensual</div></div>
      <div class="stat-card"><div class="n">${money(costoMensualTotal())}</div><div class="l">Costo mensual (fijo × grupos)</div></div>
      <div class="stat-card good"><div class="n">${money(gananciaMensual())}</div><div class="l">Ganancia mensual</div></div>
      <div class="stat-card warn"><div class="n">${pendientes}</div><div class="l">Pagos pendientes</div></div>
      <div class="stat-card danger"><div class="n">${vencidos}</div><div class="l">Pagos vencidos</div></div>
      <div class="stat-card good"><div class="n">${pagados}</div><div class="l">Pagos del mes cubiertos</div></div>
    </div>

    <div class="page-title" style="font-size:15px; margin-bottom:10px;">Próximos cobros</div>
    <table>
      <thead><tr><th>Usuario</th><th>Teléfono</th><th>Día de pago</th><th>Faltan</th><th>Servicios</th></tr></thead>
      <tbody>
        ${proximos.length === 0 ? `<tr class="empty-row"><td colspan="5">No hay usuarios registrados.</td></tr>` :
          proximos.map(({ u, dias }) => `
            <tr class="fila-usuario" data-user-row="${u.id}" style="cursor:pointer;">
              <td>${u.nombre}</td>
              <td>${u.telefono || '-'}</td>
              <td>Día ${u.diaPago}</td>
              <td>${dias === 0 ? '<span class="badge badge-warn">Hoy</span>' : dias + ' días'}</td>
              <td>${u.servicios.length}</td>
            </tr>
          `).join('')}
      </tbody>
    </table>
  `;
  main.querySelectorAll('[data-user-row]').forEach(tr => {
    tr.addEventListener('click', () => irAUsuario(tr.dataset.userRow));
  });
}

/* =========================================================
   SERVICIOS (vista general y dashboard de grupo)
========================================================= */
function renderServicios() {
  if (db.servicios.length === 0) {
    main.innerHTML = `
      <div class="page-header">
        <div>
          <div class="page-title">Servicios</div>
          <div class="page-sub">0 servicios registrados</div>
        </div>
      </div>
      <div class="placeholder-msg">Crea tu primer servicio con el botón "+" del panel izquierdo.</div>
    `;
    return;
  }

  if (!servicioSeleccionadoId || !db.servicios.some(s => s.id === servicioSeleccionadoId)) {
    servicioSeleccionadoId = db.servicios[0].id;
  }

  const servicio = db.servicios.find(s => s.id === servicioSeleccionadoId);
  const grupos = servicio.gruposInternos || [];

  if (grupoInternoSeleccionadoId && grupos.some(g => g.id === grupoInternoSeleccionadoId)) {
    renderDashboardGrupo(servicio, grupoInternoSeleccionadoId);
    return;
  }

  const totalCuentas = totalCuentasServicio(servicio);
  const cuentasUsadasTotal = grupos.reduce((acc, g) => acc + cuentasUsadasEnGrupo(servicio.id, g.id), 0);
  const costoTotal = costoTotalServicio(servicio);
  const ingreso = ingresoPorServicio(servicio.id);
  const ganancia = ingreso - costoTotal;

  main.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">${servicio.nombre}</div>
        <div class="page-sub">${grupos.length} grupo(s) · ${totalCuentas} cuentas totales · ${money(ingreso)} ingresos · ${money(ganancia)} ganancia</div>
      </div>
      <div class="tbl-actions">
        <button class="btn btn-outline" id="btnEditarServicio">Editar servicio</button>
        <button class="btn btn-danger" id="btnEliminarServicio">Eliminar servicio</button>
      </div>
    </div>
    <div class="grid-cards">
      <div class="stat-card"><div class="n">${money(costoTotal)}</div><div class="l">Costo total (fijo × ${grupos.length} grupos)</div></div>
      <div class="stat-card"><div class="n">${money(ingreso)}</div><div class="l">Ingreso por usuarios</div></div>
      <div class="stat-card ${ganancia >= 0 ? 'good' : 'danger'}"><div class="n">${money(ganancia)}</div><div class="l">Ganancia neta</div></div>
      <div class="stat-card"><div class="n">${cuentasUsadasTotal}/${totalCuentas}</div><div class="l">Cuentas en uso</div></div>
    </div>

    <div class="page-title" style="font-size:15px; margin-bottom:10px;">Grupos internos</div>
    <table>
      <thead><tr><th>Grupo</th><th>Cuentas totales</th><th>Cuentas usadas</th><th>Ingreso grupo</th><th>Ganancia grupo</th>${(servicio.tipoGrupo === 'compartido' && servicio.campoGlobal && servicio.campoGlobal.nombre) ? `<th>${servicio.campoGlobal.nombre}</th>` : ''}</tr></thead>
      <tbody>
        ${grupos.length === 0 ? `<tr class="empty-row"><td colspan="${(servicio.tipoGrupo === 'compartido' && servicio.campoGlobal && servicio.campoGlobal.nombre) ? 6 : 5}">Sin grupos. Agrégales desde el modal de edición.</td></tr>` :
          grupos.map(g => {
            const usadas = cuentasUsadasEnGrupo(servicio.id, g.id);
            const ingGrupo = ingresoGrupo(servicio.id, g.id);
            const ganGrupo = gananciaGrupo(servicio.id, g.id);
            const tieneCampoGlobal = servicio.tipoGrupo === 'compartido' && servicio.campoGlobal && servicio.campoGlobal.nombre;
            return `<tr class="grupo-clickable" data-grupo-row="${g.id}" style="cursor:pointer;">
              <td>${g.nombre}</td>
              <td>${g.cantidadCuentas}</td>
              <td>${usadas}</td>
              <td>${money(ingGrupo)}</td>
              <td class="${ganGrupo >= 0 ? 'good' : 'danger'}">${money(ganGrupo)}</td>
              ${tieneCampoGlobal ? `<td><input type="text" data-campo-global-valor="${g.id}" value="${g.campoGlobalValor || ''}" style="width:100%;" /></td>` : ''}
            </tr>`;
          }).join('')}
      </tbody>
    </table>

    <div class="page-title" style="font-size:15px; margin-bottom:10px; margin-top:24px;">Usuarios con este servicio</div>
    <table>
      <thead><tr><th>Usuario</th><th>Teléfono</th><th>Día de pago</th><th>Grupo</th><th>Precio</th></tr></thead>
      <tbody>
        ${(() => {
          const usuariosDelServicio = db.usuarios.filter(u => u.servicios.some(a => a.servicioId === servicio.id));
          if (usuariosDelServicio.length === 0) return `<tr class="empty-row"><td colspan="5">Ningún usuario tiene este servicio todavía.</td></tr>`;
          return usuariosDelServicio.map(u => {
            const a = u.servicios.find(x => x.servicioId === servicio.id);
            const grupo = grupos.find(g => g.id === a.grupoInternoId);
            return `<tr class="fila-usuario" data-user-row="${u.id}" style="cursor:pointer;"><td>${u.nombre}</td><td>${u.telefono || '-'}</td><td>Día ${u.diaPago}</td><td>${grupo ? grupo.nombre : '—'}</td><td>${money(a.precio)}</td></tr>`;
          }).join('');
        })()}
      </tbody>
    </table>
  `;

  document.getElementById('btnEditarServicio').addEventListener('click', () => abrirModalServicio(servicio.id));
  document.getElementById('btnEliminarServicio').addEventListener('click', () => eliminarServicio(servicio.id));
  main.querySelectorAll('[data-grupo-row]').forEach(tr => {
    tr.addEventListener('click', (e) => {
      if (e.target.closest('input')) return;
      grupoInternoSeleccionadoId = tr.dataset.grupoRow;
      renderSidebars();
      renderServicios();
    });
  });
  main.querySelectorAll('[data-user-row]').forEach(tr => {
    tr.addEventListener('click', () => irAUsuario(tr.dataset.userRow));
  });
  main.querySelectorAll('[data-campo-global-valor]').forEach(input => {
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('change', async () => {
      const grupo = (servicio.gruposInternos || []).find(g => g.id === input.dataset.campoGlobalValor);
      if (!grupo) return;
      grupo.campoGlobalValor = input.value;
      await persist();
      showToast('Campo actualizado.');
    });
  });
}

function renderDashboardGrupo(servicio, grupoId) {
  const grupo = servicio.gruposInternos.find(g => g.id === grupoId);
  if (!grupo) return;

  const usadas = cuentasUsadasEnGrupo(servicio.id, grupoId);
  const ingGrupo = ingresoGrupo(servicio.id, grupoId);
  const ganGrupo = gananciaGrupo(servicio.id, grupoId);
  const pctGanancia = ingGrupo > 0 ? (ganGrupo / ingGrupo * 100) : 0;
  const usuariosDelGrupo = db.usuarios.filter(u => u.servicios.some(a => a.servicioId === servicio.id && a.grupoInternoId === grupoId));

  main.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">${servicio.nombre} → ${grupo.nombre}</div>
        <div class="page-sub">Dashboard del grupo · ${usadas} de ${grupo.cantidadCuentas} cuentas usadas</div>
      </div>
    </div>
    <div class="grid-cards">
      <div class="stat-card"><div class="n">${usadas}/${grupo.cantidadCuentas}</div><div class="l">Cuentas usadas/disponibles</div></div>
      <div class="stat-card good"><div class="n">${money(ingGrupo)}</div><div class="l">Ingreso mensual</div></div>
      <div class="stat-card ${pctGanancia >= 0 ? 'good' : 'danger'}"><div class="n">${pctGanancia.toFixed(1)}%</div><div class="l">% Ganancia</div></div>
      <div class="stat-card ${ganGrupo >= 0 ? 'good' : 'danger'}"><div class="n">${money(ganGrupo)}</div><div class="l">Ganancia neta</div></div>
    </div>

    <div class="page-title" style="font-size:15px; margin-bottom:10px;">Usuarios en este grupo</div>
    <table>
      <thead><tr><th>Usuario</th><th>Teléfono</th><th>Día de pago</th><th>Precio</th></tr></thead>
      <tbody>
        ${usuariosDelGrupo.length === 0 ? `<tr class="empty-row"><td colspan="4">Ningún usuario en este grupo.</td></tr>` :
          usuariosDelGrupo.map(u => {
            const a = u.servicios.find(x => x.servicioId === servicio.id);
            return `<tr class="fila-usuario" data-user-row="${u.id}" style="cursor:pointer;"><td>${u.nombre}</td><td>${u.telefono || '-'}</td><td>Día ${u.diaPago}</td><td>${money(a.precio)}</td></tr>`;
          }).join('')}
      </tbody>
    </table>
  `;
  main.querySelectorAll('[data-user-row]').forEach(tr => {
    tr.addEventListener('click', () => irAUsuario(tr.dataset.userRow));
  });
}

/* =========================================================
   SERVICIOS (CRUD con grupos internos)
========================================================= */
function abrirModalServicio(id) {
  editandoServicioId = id;
  const modal = document.getElementById('modalServicio');
  document.getElementById('tituloModalServicio').textContent = id ? 'Editar servicio' : 'Nuevo servicio';

  if (id) {
    const s = db.servicios.find(x => x.id === id);
    document.getElementById('svcNombre').value = s.nombre;
    document.getElementById('svcCosto').value = s.costoMensual;
    document.getElementById('svcPrecio').value = s.precioMensual;
    document.getElementById('svcTipoGrupo').value = s.tipoGrupo === 'compartido' ? 'compartido' : 'individual';
    const grupos = s.gruposInternos || [];
    const cuentasPorGrupo = grupos.length > 0 ? (grupos[0].cantidadCuentas || 1) : 1;
    document.getElementById('svcCuentasPorGrupo').value = cuentasPorGrupo;
    document.getElementById('svcCampoGlobalNombre').value = (s.campoGlobal && s.campoGlobal.nombre) || '';
    renderGruposInternos(grupos);
    renderCamposPersonalizados(s.camposPersonalizados || []);
  } else {
    document.getElementById('svcNombre').value = '';
    document.getElementById('svcCosto').value = '';
    document.getElementById('svcPrecio').value = '';
    document.getElementById('svcTipoGrupo').value = 'individual';
    document.getElementById('svcCuentasPorGrupo').value = 1;
    document.getElementById('svcCampoGlobalNombre').value = '';
    renderGruposInternos([{ id: uid('gpo'), nombre: 'Grupo 1', cantidadCuentas: 1 }]);
    renderCamposPersonalizados([]);
  }
  actualizarHintTipoGrupo();
  modal.classList.add('active');
}

function actualizarHintTipoGrupo() {
  const tipo = document.getElementById('svcTipoGrupo').value;
  const hint = document.getElementById('svcTipoGrupoHint');
  hint.textContent = tipo === 'compartido'
    ? 'Compartido: el costo fijo se reparte entre todos los grupos (no se multiplica).'
    : 'Individual: el costo fijo se multiplica por cada grupo.';
  document.getElementById('svcCampoGlobalRow').style.display = tipo === 'compartido' ? '' : 'none';
}

function renderGruposInternos(grupos) {
  const container = document.getElementById('gruposInternosContainer');
  if (!grupos || grupos.length === 0) {
    container.innerHTML = `<div class="hint" style="padding:6px 0;">Sin grupos. Agrega uno con el botón "+".</div>`;
    return;
  }
  container.innerHTML = grupos.map((g, idx) => `
    <div class="grupo-interno-item" data-grupo-idx="${idx}">
      <input type="text" value="${g.nombre}" data-grupo-nombre="${idx}" style="flex:2;" />
      <span style="font-size:12px; color:#888; margin-left:4px;">(${g.cantidadCuentas} cuentas)</span>
      <button class="btn-remove" data-delgrupo="${idx}">✕</button>
    </div>
  `).join('');
  container.querySelectorAll('[data-delgrupo]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.delgrupo);
      const grupos = obtenerGruposInternosFromUI();
      grupos.splice(idx, 1);
      renderGruposInternos(grupos);
    });
  });
}

function obtenerGruposInternosFromUI() {
  const items = document.querySelectorAll('#gruposInternosContainer .grupo-interno-item');
  const grupos = [];
  const cuentasPorGrupo = Number(document.getElementById('svcCuentasPorGrupo').value) || 1;
  items.forEach(item => {
    const nombre = item.querySelector('[data-grupo-nombre]').value.trim() || 'Grupo';
    const id = item.dataset.grupoId || uid('gpo');
    grupos.push({ id, nombre, cantidadCuentas: cuentasPorGrupo, campoGlobalValor: '' });
    item.dataset.grupoId = id;
  });
  return grupos;
}

document.getElementById('svcTipoGrupo').addEventListener('change', actualizarHintTipoGrupo);

document.getElementById('btnAgregarGrupoInterno').addEventListener('click', () => {
  const grupos = obtenerGruposInternosFromUI();
  const n = grupos.length + 1;
  const cuentasPorGrupo = Number(document.getElementById('svcCuentasPorGrupo').value) || 1;
  grupos.push({ id: uid('gpo'), nombre: 'Grupo ' + n, cantidadCuentas: cuentasPorGrupo });
  renderGruposInternos(grupos);
});

function renderCamposPersonalizados(campos) {
  const container = document.getElementById('camposContainer');
  container.innerHTML = campos.map((c, idx) => `
    <div class="campo-item">
      <input type="text" value="${c}" data-campo-idx="${idx}" disabled />
      <button class="btn-remove" data-delcampo="${idx}">✕</button>
    </div>
  `).join('');
  container.querySelectorAll('[data-delcampo]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.delcampo);
      const campos = obtenerCamposPersonalizados();
      campos.splice(idx, 1);
      renderCamposPersonalizados(campos);
    });
  });
}

function obtenerCamposPersonalizados() {
  const inputs = document.querySelectorAll('#camposContainer input');
  const campos = [];
  inputs.forEach(inp => {
    const val = inp.value.trim();
    if (val) campos.push(val);
  });
  return campos;
}

document.getElementById('btnAgregarCampo').addEventListener('click', () => {
  const input = document.getElementById('nuevoCampoNombre');
  const nombre = input.value.trim();
  if (!nombre) { showToast('Escribe un nombre para el campo.'); return; }
  const campos = obtenerCamposPersonalizados();
  campos.push(nombre);
  renderCamposPersonalizados(campos);
  input.value = '';
});

document.getElementById('cancelServicio').addEventListener('click', () => {
  document.getElementById('modalServicio').classList.remove('active');
});

document.getElementById('confirmServicio').addEventListener('click', async () => {
  const nombre = document.getElementById('svcNombre').value.trim();
  const costo = document.getElementById('svcCosto').value;
  const precio = document.getElementById('svcPrecio').value;
  const tipoGrupo = document.getElementById('svcTipoGrupo').value === 'compartido' ? 'compartido' : 'individual';
  const cuentasPorGrupo = Number(document.getElementById('svcCuentasPorGrupo').value) || 1;
  const campoGlobalNombre = tipoGrupo === 'compartido' ? document.getElementById('svcCampoGlobalNombre').value.trim() : '';
  if (!nombre || costo === '' || precio === '') {
    showToast('Nombre, costo fijo y precio son obligatorios.');
    return;
  }

  let grupos = obtenerGruposInternosFromUI();
  if (grupos.length === 0) {
    showToast('Agrega al menos un grupo interno.');
    return;
  }

  // Asegurar que todos los grupos tengan la misma cantidad de cuentas
  grupos.forEach(g => g.cantidadCuentas = cuentasPorGrupo);
  const campos = obtenerCamposPersonalizados();

  if (editandoServicioId) {
    const s = db.servicios.find(x => x.id === editandoServicioId);
    s.nombre = nombre;
    s.costoMensual = Number(costo);
    s.precioMensual = Number(precio);
    s.tipoGrupo = tipoGrupo;
    grupos.forEach(g => {
      const existente = (s.gruposInternos || []).find(og => og.id === g.id);
      g.campoGlobalValor = existente ? (existente.campoGlobalValor || '') : '';
    });
    s.gruposInternos = grupos;
    s.camposPersonalizados = campos;
    s.campoGlobal = campoGlobalNombre ? { nombre: campoGlobalNombre } : null;
    db.usuarios.forEach(u => {
      u.servicios.forEach(a => {
        if (a.servicioId === editandoServicioId) {
          const grupoExiste = grupos.some(g => g.id === a.grupoInternoId);
          if (!grupoExiste) a.grupoInternoId = grupos.length > 0 ? grupos[0].id : null;
          if (a.valoresPersonalizados) {
            const nuevos = {};
            campos.forEach(c => { if (a.valoresPersonalizados[c] !== undefined) nuevos[c] = a.valoresPersonalizados[c]; });
            a.valoresPersonalizados = nuevos;
          }
        }
      });
    });
  } else {
    const newSvc = {
      id: uid('svc'),
      nombre,
      costoMensual: Number(costo),
      precioMensual: Number(precio),
      tipoGrupo,
      gruposInternos: grupos,
      camposPersonalizados: campos,
      campoGlobal: campoGlobalNombre ? { nombre: campoGlobalNombre } : null
    };
    db.servicios.push(newSvc);
  }
  await persist();
  document.getElementById('modalServicio').classList.remove('active');
  if (!editandoServicioId) servicioSeleccionadoId = db.servicios[db.servicios.length - 1].id;
  render();
  showToast('Servicio guardado.');
});

function eliminarServicio(id) {
  if (!confirm('¿Eliminar este servicio? Se quitará de todos los usuarios.')) return;
  db.usuarios.forEach(u => { u.servicios = u.servicios.filter(s => s.servicioId !== id); });
  db.servicios = db.servicios.filter(s => s.id !== id);
  if (servicioSeleccionadoId === id) servicioSeleccionadoId = null;
  persist().then(() => { render(); showToast('Servicio eliminado.'); });
}

/* =========================================================
   USUARIOS (sin cambios funcionales)
========================================================= */
function renderUsuarios() {
  if (db.usuarios.length === 0) {
    main.innerHTML = `
      <div class="page-header">
        <div>
          <div class="page-title">Usuarios</div>
          <div class="page-sub">0 usuarios registrados</div>
        </div>
        <button class="btn btn-primary" id="btnNuevoUsuario" ${db.servicios.length === 0 ? 'disabled' : ''}>+ Nuevo usuario</button>
      </div>
      <div class="placeholder-msg">${db.servicios.length === 0 ? 'Primero debes crear al menos un servicio para poder registrar usuarios.' : 'No hay usuarios. Crea el primero.'}</div>
    `;
    document.getElementById('btnNuevoUsuario')?.addEventListener('click', () => abrirModalUsuario(null));
    return;
  }

  const u = db.usuarios.find(x => x.id === usuarioSeleccionadoId) || db.usuarios[0];
  const total = u.servicios.reduce((acc, s) => acc + (Number(s.precio) || 0), 0);
  const dias = diasParaProximoPago(Number(u.diaPago) || 1);

  main.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">${u.nombre}</div>
        <div class="page-sub">Teléfono: ${u.telefono || '-'} · Día de pago: ${u.diaPago} · Próximo cobro en ${dias} día(s)</div>
      </div>
      <div class="tbl-actions">
        <button class="btn btn-outline" id="btnEditarUsuario">Editar</button>
        <button class="btn btn-danger" id="btnEliminarUsuario">Eliminar</button>
      </div>
    </div>
    <div class="grid-cards">
      <div class="stat-card good"><div class="n">${money(total)}</div><div class="l">Total mensual</div></div>
      <div class="stat-card"><div class="n">${u.servicios.length}</div><div class="l">Servicios asociados</div></div>
    </div>
    <div class="page-title" style="font-size:15px; margin-bottom:10px;">Servicios y accesos</div>
    <div class="svc-acc-list">
      ${u.servicios.length === 0 ? `<div class="placeholder-msg" style="padding:20px;">Sin servicios asociados.</div>` :
        u.servicios.map((a, idx) => {
          const svc = db.servicios.find(x => x.id === a.servicioId);
          const grupo = svc ? (svc.gruposInternos || []).find(g => g.id === a.grupoInternoId) : null;
          const campos = a.valoresPersonalizados || {};
          const camposFilas = Object.keys(campos).length > 0
            ? Object.entries(campos).map(([k, v]) => `<div class="svc-kv-row"><span class="svc-kv-label">${k}</span><span class="svc-kv-value${v ? '' : ' muted'}">${v || 'Sin especificar'}</span></div>`).join('')
            : `<div class="svc-kv-row"><span class="svc-kv-label">Campos</span><span class="svc-kv-value muted">Sin campos personalizados</span></div>`;
          return `
            <div class="svc-acc-item" data-svc-acc="${idx}">
              <div class="svc-acc-header" data-svc-acc-toggle="${idx}">
                <div class="svc-acc-title">
                  <span class="svc-badge">${svc ? svc.nombre : '?'}</span>
                  <span class="svc-acc-sub"><strong>${grupo ? grupo.nombre : 'Sin grupo asignado'}</strong> · <strong>${money(a.precio)}</strong>/mes</span>
                </div>
                <span class="svc-acc-caret">▾</span>
              </div>
              <div class="svc-acc-body">
                <div class="svc-kv">
                  <div class="svc-kv-row"><span class="svc-kv-label">Descuento mensual</span><span class="svc-kv-value" style="color:#157347;font-weight:700;">${money((svc ? svc.precioMensual : 0) - a.precio)}</span></div>
                  ${camposFilas}
                </div>
              </div>
            </div>
          `;
        }).join('')}
    </div>
  `;
  document.getElementById('btnEditarUsuario').addEventListener('click', () => abrirModalUsuario(u.id));
  main.querySelectorAll('[data-svc-acc-toggle]').forEach(header => {
    header.addEventListener('click', () => {
      header.closest('.svc-acc-item').classList.toggle('expanded');
    });
  });
  document.getElementById('btnEliminarUsuario').addEventListener('click', () => eliminarUsuario(u.id));
  renderHistorialSidebar(u);
}

/* =========================================================
   HISTORIAL DE PAGOS (sidebar derecho, vista Usuarios)
========================================================= */
function generarPeriodosHistorial(u) {
  const hoy = new Date();
  const anioActual = hoy.getFullYear();
  const mesActual = hoy.getMonth();
  const periodos = [];
  for (let mes = 0; mes <= 11; mes++) {
    const d = new Date(anioActual, mes, 1);
    const periodo = anioActual + '-' + String(mes + 1).padStart(2, '0');
    const esFuturo = mes > mesActual;
    const esActual = mes === mesActual;
    let estado;
    if (esFuturo || u.servicios.length === 0) {
      estado = 'proximo';
    } else {
      const todosPagados = u.servicios.every(a => pagoRegistrado(u.id, a.servicioId, periodo));
      estado = todosPagados ? 'pagado' : 'pendiente';
    }
    const monto = u.servicios.reduce((acc, a) => acc + (Number(a.precio) || 0), 0);
    periodos.push({ periodo, label: d.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' }), esActual, estado, monto });
  }
  return periodos;
}

function renderHistorialSidebar(u) {
  const shSub = document.getElementById('shSub');
  const shList = document.getElementById('shList');
  if (!u) {
    shSub.textContent = '-';
    shList.innerHTML = `<div class="sh-empty">Selecciona un usuario.</div>`;
    return;
  }
  shSub.textContent = u.nombre;
  const periodos = generarPeriodosHistorial(u);
  const badgeInfo = {
    pagado: { clase: 'badge-ok', texto: 'Pagado' },
    pendiente: { clase: 'badge-danger', texto: 'Pendiente' },
    proximo: { clase: 'badge-neutral', texto: 'Próximo' }
  };
  shList.innerHTML = periodos.map(p => {
    const b = badgeInfo[p.estado];
    return `
      <div class="sh-item ${p.esActual ? 'sh-current' : ''}">
        <div class="sh-item-main">
          <span class="sh-item-label">${p.label}</span>
          ${p.esActual ? '<span class="sh-current-tag">Mes actual</span>' : `<span class="sh-item-monto">${money(p.monto)}</span>`}
        </div>
        <span class="badge ${b.clase}">${b.texto}</span>
      </div>
    `;
  }).join('');
}

function abrirModalUsuario(id) {
  editandoUsuarioId = id;
  document.getElementById('tituloModalUsuario').textContent = id ? 'Editar usuario' : 'Nuevo usuario';
  if (id) {
    const u = db.usuarios.find(x => x.id === id);
    document.getElementById('usrNombre').value = u.nombre;
    document.getElementById('usrTelefono').value = u.telefono || '';
    document.getElementById('usrDiaPago').value = u.diaPago || '';
    asignacionesTemp = JSON.parse(JSON.stringify(u.servicios));
  } else {
    document.getElementById('usrNombre').value = '';
    document.getElementById('usrTelefono').value = '';
    document.getElementById('usrDiaPago').value = '';
    asignacionesTemp = [];
  }
  renderAsignacionesTemp();
  poblarSelectServicios();
  document.getElementById('modalUsuario').classList.add('active');
}

function poblarSelectServicios() {
  const sel = document.getElementById('selectAgregarServicio');
  sel.innerHTML = '<option value="">+ Agregar servicio...</option>';
  db.servicios.forEach(s => {
    const yaAsignado = asignacionesTemp.some(a => a.servicioId === s.id);
    if (!yaAsignado) {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.nombre + ' (' + (s.gruposInternos || []).length + ' grupos)';
      sel.appendChild(opt);
    }
  });
}

function renderAsignacionesTemp() {
  const cont = document.getElementById('usrServiciosAsignados');
  if (asignacionesTemp.length === 0) {
    cont.innerHTML = `<div class="hint">Sin servicios asociados aún.</div>`;
    return;
  }
  cont.innerHTML = asignacionesTemp.map((a, idx) => {
    const svc = db.servicios.find(x => x.id === a.servicioId);
    const grupo = svc ? (svc.gruposInternos || []).find(g => g.id === a.grupoInternoId) : null;
    const camposPersonalizados = a.valoresPersonalizados || {};
    const camposStr = Object.entries(camposPersonalizados).map(([k,v]) => `${k}: ${v}`).join(', ');
    return `
      <div class="svc-assign-block">
        <div class="top">
          <strong>${svc ? svc.nombre : '?'} · ${grupo ? grupo.nombre : 'Sin grupo asignado'}</strong>
          <div>
            <button class="btn btn-outline btn-sm" data-editasig="${idx}">Editar acceso</button>
            <button class="remove-btn" data-delasig="${idx}">Quitar ✕</button>
          </div>
        </div>
        <div class="detalle">
          <span>Precio: ${money(a.precio)}</span>
          ${camposStr ? `<span>Campos: ${camposStr}</span>` : ''}
        </div>
      </div>
    `;
  }).join('');

  cont.querySelectorAll('[data-editasig]').forEach(b => b.addEventListener('click', () => abrirModalAsignacion(Number(b.dataset.editasig), false)));
  cont.querySelectorAll('[data-delasig]').forEach(b => b.addEventListener('click', () => {
    asignacionesTemp.splice(Number(b.dataset.delasig), 1);
    renderAsignacionesTemp();
    poblarSelectServicios();
  }));
}

document.getElementById('selectAgregarServicio').addEventListener('change', function() {
  const servicioId = this.value;
  if (!servicioId) return;
  const svc = db.servicios.find(x => x.id === servicioId);
  const grupos = svc ? svc.gruposInternos || [] : [];
  const grupoId = grupos.length > 0 ? grupos[0].id : null;
  const nuevaAsignacion = {
    servicioId,
    grupoInternoId: grupoId,
    precio: svc.precioMensual,
    valoresPersonalizados: {}
  };
  asignacionesTemp.push(nuevaAsignacion);
  renderAsignacionesTemp();
  poblarSelectServicios();
  abrirModalAsignacion(asignacionesTemp.length - 1, true);
});

function abrirModalAsignacion(idx, esNueva) {
  asignacionEditIndex = idx;
  const a = asignacionesTemp[idx];
  const svc = db.servicios.find(x => x.id === a.servicioId);

  document.getElementById('tituloModalAsignacion').textContent = esNueva ? 'Agregar acceso — ' + (svc ? svc.nombre : '') : 'Editar acceso — ' + (svc ? svc.nombre : '');
  document.getElementById('asigPrecio').value = a.precio;

  // Si el usuario ya existía en la BD y este servicio ya estaba asignado,
  // su cupo actual ya se cuenta dentro de "usadas"; hay que devolvérselo
  // para que no se descuente a sí mismo. Para usuarios/asignaciones nuevas
  // (aún no guardadas) no hay ningún cupo real ocupado todavía.
  let grupoOriginalEnDB = null;
  if (editandoUsuarioId) {
    const uOriginal = db.usuarios.find(x => x.id === editandoUsuarioId);
    const asigOriginal = uOriginal ? uOriginal.servicios.find(s => s.servicioId === a.servicioId) : null;
    if (asigOriginal) grupoOriginalEnDB = asigOriginal.grupoInternoId;
  }

  const grupoSelect = document.getElementById('asigGrupoInterno');
  const grupoHint = document.getElementById('asigGrupoHint');
  grupoSelect.innerHTML = '<option value="">— Seleccionar grupo —</option>';
  if (svc && svc.gruposInternos && svc.gruposInternos.length > 0) {
    svc.gruposInternos.forEach(g => {
      const usadas = cuentasUsadasEnGrupo(svc.id, g.id);
      const ocupadaPorEstaAsignacion = (grupoOriginalEnDB === g.id) ? 1 : 0;
      const disponibles = Math.max(0, (Number(g.cantidadCuentas) || 0) - usadas + ocupadaPorEstaAsignacion);
      const opt = document.createElement('option');
      opt.value = g.id;
      opt.textContent = g.nombre + ' — ' + disponibles + (disponibles === 1 ? ' cuenta disponible' : ' cuentas disponibles');
      if (disponibles <= 0) opt.disabled = true;
      if (g.id === a.grupoInternoId) opt.selected = true;
      grupoSelect.appendChild(opt);
    });
    grupoHint.textContent = 'Selecciona a qué grupo de cuentas pertenece este usuario dentro del servicio.';
  } else {
    grupoHint.textContent = 'Este servicio no tiene grupos internos configurados.';
  }

  const seccionCampos = document.getElementById('asigCamposSection');
  const container = document.getElementById('asigCamposPersonalizados');
  container.innerHTML = '';
  if (svc && svc.camposPersonalizados && svc.camposPersonalizados.length > 0) {
    seccionCampos.style.display = '';
    const valores = a.valoresPersonalizados || {};
    svc.camposPersonalizados.forEach(campo => {
      const div = document.createElement('div');
      div.className = 'form-row';
      div.innerHTML = `
        <label>${campo}</label>
        <input type="text" class="asig-campo-personalizado" data-campo="${campo}" value="${valores[campo] || ''}" />
      `;
      container.appendChild(div);
    });
  } else {
    seccionCampos.style.display = 'none';
  }

  document.getElementById('modalAsignacion').classList.add('active');
}

document.getElementById('cancelAsignacion').addEventListener('click', () => {
  document.getElementById('modalAsignacion').classList.remove('active');
});

document.getElementById('confirmAsignacion').addEventListener('click', () => {
  const a = asignacionesTemp[asignacionEditIndex];
  const grupoVal = document.getElementById('asigGrupoInterno').value;
  const grupoOpt = document.querySelector('#asigGrupoInterno option:checked');
  if (grupoVal && grupoOpt && grupoOpt.disabled) { showToast('Ese grupo ya no tiene cuentas disponibles.'); return; }
  a.grupoInternoId = grupoVal || null;
  a.precio = Number(document.getElementById('asigPrecio').value) || 0;

  const camposInputs = document.querySelectorAll('#asigCamposPersonalizados .asig-campo-personalizado');
  const valores = {};
  camposInputs.forEach(inp => {
    const campo = inp.dataset.campo;
    valores[campo] = inp.value.trim();
  });
  a.valoresPersonalizados = valores;

  document.getElementById('modalAsignacion').classList.remove('active');
  renderAsignacionesTemp();
});

document.getElementById('cancelUsuario').addEventListener('click', () => {
  document.getElementById('modalUsuario').classList.remove('active');
});

document.getElementById('confirmUsuario').addEventListener('click', async () => {
  const nombre = document.getElementById('usrNombre').value.trim();
  const telefono = document.getElementById('usrTelefono').value.trim();
  const diaPago = document.getElementById('usrDiaPago').value;
  if (!nombre || !diaPago) { showToast('Nombre y día de pago son obligatorios.'); return; }
  if (asignacionesTemp.length === 0) { showToast('Asocia al menos un servicio.'); return; }

  const sinGrupo = asignacionesTemp.some(a => !a.grupoInternoId);
  if (sinGrupo) {
    if (!confirm('Algunos servicios no tienen grupo interno asignado. ¿Continuar de todas formas?')) return;
  }

  if (editandoUsuarioId) {
    const u = db.usuarios.find(x => x.id === editandoUsuarioId);
    u.nombre = nombre; u.telefono = telefono; u.diaPago = Number(diaPago); u.servicios = asignacionesTemp;
  } else {
    db.usuarios.push({ id: uid('usr'), nombre, telefono, diaPago: Number(diaPago), servicios: asignacionesTemp });
  }
  await persist();
  document.getElementById('modalUsuario').classList.remove('active');
  if (!editandoUsuarioId) usuarioSeleccionadoId = db.usuarios[db.usuarios.length - 1].id;
  render();
  showToast('Usuario guardado.');
});

function eliminarUsuario(id) {
  if (!confirm('¿Eliminar este usuario y su historial de pagos?')) return;
  db.usuarios = db.usuarios.filter(u => u.id !== id);
  db.pagos = db.pagos.filter(p => p.usuarioId !== id);
  usuarioSeleccionadoId = null;
  persist().then(() => { render(); showToast('Usuario eliminado.'); });
}

/* =========================================================
   PAGOS Y ADEUDOS (agrupado por usuario)
========================================================= */
function diasHastaVencimiento(diaPago) {
  const hoy = new Date();
  const hoySinHora = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  const venc = new Date(hoy.getFullYear(), hoy.getMonth(), Number(diaPago) || 1);
  return Math.round((venc - hoySinHora) / 86400000); // negativo = vencido
}

function renderPagos() {
  const periodo = periodoActual();

  const filas = db.usuarios
    .filter(u => u.servicios.length > 0)
    .map(u => {
      const totalMonto = u.servicios.reduce((acc, a) => acc + (Number(a.precio) || 0), 0);
      const pagadoCompleto = u.servicios.every(s => pagoRegistrado(u.id, s.servicioId, periodo));
      const dias = diasHastaVencimiento(u.diaPago);
      return { usuario: u, totalMonto, dias, pagadoCompleto, estado: dias < 0 ? 'vencido' : 'proximo' };
    })
    .filter(f => !f.pagadoCompleto && f.dias <= 7) // ventana: vencidos + próximos 7 días
    .sort((a, b) => a.dias - b.dias);

  const countVencidos = filas.filter(f => f.estado === 'vencido').length;
  const countProximos = filas.length - countVencidos;
  const totalAdeudado = filas.reduce((acc, f) => acc + f.totalMonto, 0);
  const pagados = db.usuarios
    .filter(u => u.servicios.length > 0 && u.servicios.every(s => pagoRegistrado(u.id, s.servicioId, periodo)))
    .map(u => ({
      usuario: u,
      totalMonto: u.servicios.reduce((acc, a) => acc + (Number(a.precio) || 0), 0)
    }))
    .sort((a, b) => a.usuario.nombre.localeCompare(b.usuario.nombre));

  main.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Pagos y adeudos</div>
        <div class="page-sub">Periodo: ${periodo} · Vencidos y próximos 7 días (se recalcula cada mes)</div>
      </div>
    </div>
    <div class="grid-cards">
      <div class="stat-card danger"><div class="n">${countVencidos}</div><div class="l">Vencidos</div></div>
      <div class="stat-card warn"><div class="n">${countProximos}</div><div class="l">Próximos 7 días</div></div>
      <div class="stat-card danger"><div class="n">${money(totalAdeudado)}</div><div class="l">Total por cobrar</div></div>
    </div>
    <table>
      <thead><tr><th>Usuario</th><th>Servicios</th><th>Día pago</th><th>Vence</th><th>Monto</th><th>Estado</th><th>Acción</th></tr></thead>
      <tbody>
        ${filas.length === 0 ? `<tr class="empty-row"><td colspan="7">Sin adeudos ni cobros próximos.</td></tr>` :
          filas.map(f => `
            <tr class="fila-usuario ${f.estado === 'vencido' ? 'fila-urgente' : ''}" data-user-row="${f.usuario.id}" style="cursor:pointer;">
              <td>${f.usuario.nombre}</td>
              <td>${f.usuario.servicios.length}</td>
              <td>Día ${f.usuario.diaPago}</td>
              <td>${f.dias < 0 ? `Hace ${Math.abs(f.dias)} día(s)` : f.dias === 0 ? 'Hoy' : `En ${f.dias} día(s)`}</td>
              <td>${money(f.totalMonto)}</td>
              <td>${f.estado === 'vencido' ? '<span class="badge badge-danger">Urgente</span>' : '<span class="badge badge-warn">Próximo</span>'}</td>
              <td class="tbl-actions"><button class="btn btn-primary btn-sm" data-pay-all="${f.usuario.id}">Marcar pagado</button></td>
            </tr>
          `).join('')}
      </tbody>
    </table>
    <div class="page-title" style="font-size:15px; margin:24px 0 10px; display:flex; align-items:center; gap:8px; cursor:pointer;" id="togglePagados">
      <span id="pagadosCaret" style="font-size:11px; transition: transform .18s; display:inline-block;">▸</span>
      Pagos realizados (${pagados.length})
    </div>
    <div id="tablaPagados" style="display:none;">
      <table>
        <thead><tr><th>Usuario</th><th>Servicios</th><th>Día pago</th><th>Monto</th><th>Estado</th></tr></thead>
        <tbody>
          ${pagados.length === 0 ? `<tr class="empty-row"><td colspan="5">Sin pagos realizados este periodo.</td></tr>` :
            pagados.map(p => `
              <tr class="fila-usuario" data-user-row-pagado="${p.usuario.id}" style="cursor:pointer;">
                <td>${p.usuario.nombre}</td>
                <td>${p.usuario.servicios.length}</td>
                <td>Día ${p.usuario.diaPago}</td>
                <td>${money(p.totalMonto)}</td>
                <td><span class="badge badge-ok">Pagado</span></td>
              </tr>
            `).join('')}
        </tbody>
      </table>
    </div>
  `;

  main.querySelectorAll('[data-user-row]').forEach(tr => {
    tr.addEventListener('click', e => { if (!e.target.closest('button')) irAUsuario(tr.dataset.userRow); });
  });

  main.querySelectorAll('[data-pay-all]').forEach(b => b.addEventListener('click', async e => {
    e.stopPropagation();
    const u = db.usuarios.find(x => x.id === b.dataset.payAll);
    if (!u) return;
    u.servicios.forEach(s => {
      if (!pagoRegistrado(u.id, s.servicioId, periodo)) {
        db.pagos.push({ id: uid('pago'), usuarioId: u.id, servicioId: s.servicioId, periodo, monto: Number(s.precio) || 0, fecha: new Date().toISOString(), estado: 'pagado' });
      }
    });
    await persist();
    renderPagos();
    showToast('Pago registrado.');
  }));

  document.getElementById('togglePagados').addEventListener('click', () => {
    const tabla = document.getElementById('tablaPagados');
    const caret = document.getElementById('pagadosCaret');
    const visible = tabla.style.display !== 'none';
    tabla.style.display = visible ? 'none' : 'block';
    caret.style.transform = visible ? 'rotate(0deg)' : 'rotate(90deg)';
  });

  main.querySelectorAll('[data-user-row-pagado]').forEach(tr => {
    tr.addEventListener('click', () => irAUsuario(tr.dataset.userRowPagado));
  });
}

/* =========================================================
   BUSCADOR GLOBAL
========================================================= */
const buscadorGlobal = document.getElementById('buscadorGlobal');
const searchBackdrop = document.getElementById('searchBackdrop');
const searchResults = document.getElementById('searchResults');

function cerrarBusqueda() {
  searchBackdrop.classList.remove('active');
  searchResults.classList.remove('active');
}

function ejecutarBusqueda() {
  const q = buscadorGlobal.value.trim().toLowerCase();
  if (!q || q.length < 2) { cerrarBusqueda(); return; }

  const svcs = db.servicios.filter(s => s.nombre.toLowerCase().includes(q));
  const usrs = db.usuarios.filter(u => u.nombre.toLowerCase().includes(q));
  const total = svcs.length + usrs.length;

  let headerHtml;
  if (total === 1) {
    if (svcs.length === 1) {
      const s = svcs[0];
      const ingreso = ingresoPorServicio(s.id);
      const ganancia = ingreso - costoTotalServicio(s);
      headerHtml = `
        <div>
          <div class="sr-titulo">${s.nombre}</div>
          <div class="sr-mini-stats"><span>Ingreso: <b>${money(ingreso)}</b></span><span>Ganancia: <b>${money(ganancia)}</b></span></div>
        </div>
        <button class="btn btn-outline btn-sm" data-svc-editar="${s.id}">Editar</button>
      `;
    } else {
      const u = usrs[0];
      const totalM = u.servicios.reduce((acc, a) => acc + (Number(a.precio) || 0), 0);
      headerHtml = `
        <div>
          <div class="sr-titulo">${u.nombre}</div>
          <div class="sr-mini-stats"><span>Total: <b>${money(totalM)}</b></span><span>Servicios: <b>${u.servicios.length}</b></span></div>
        </div>
        <button class="btn btn-outline btn-sm" data-usr-editar="${u.id}">Editar</button>
      `;
    }
  } else {
    headerHtml = `<div><strong>Resultados</strong> <span class="sr-count">${total} encontrado(s)</span></div>`;
  }

  let html = `
    <div class="sr-topbar">
      ${headerHtml}
      <button class="sr-close" id="srCloseBtn">✕</button>
    </div>
  `;

  if (total === 0) {
    html += `<div class="sr-empty">Sin resultados para "${buscadorGlobal.value}".</div>`;
  } else {
    if (svcs.length > 0) {
      html += `<div class="sr-group">Servicios (${svcs.length})</div>`;
      svcs.forEach(s => { html += tarjetaServicioRapida(s, total === 1); });
    }
    if (usrs.length > 0) {
      html += `<div class="sr-group">Usuarios (${usrs.length})</div>`;
      usrs.forEach(u => { html += tarjetaUsuarioRapida(u, total === 1); });
    }
  }

  searchResults.innerHTML = html;
  document.getElementById('srCloseBtn').addEventListener('click', () => { cerrarBusqueda(); buscadorGlobal.value = ''; });
  enlazarTarjetasRapidas();
  searchBackdrop.classList.add('active');
  searchResults.classList.add('active');
}

/* ---- Tarjeta de servicio (solo lectura) ---- */
function tarjetaServicioRapida(s, ocultarTitulo) {
  const totalCuentas = totalCuentasServicio(s);
  const costoTotal = costoTotalServicio(s);
  const ingreso = ingresoPorServicio(s.id);
  const ganancia = ingreso - costoTotal;

  return `
    <div class="sr-card" data-servicio-card="${s.id}">
      ${ocultarTitulo ? '' : `
      <div class="sr-card-head">
        <span class="sr-card-title">${s.nombre}</span>
        <button class="btn btn-outline btn-sm" data-svc-editar="${s.id}">Editar</button>
      </div>`}
      <div class="sr-stats-row">
        <div class="sr-stat good"><div class="n">${money(ingreso)}</div><div class="l">Ingreso mensual</div></div>
        <div class="sr-stat ${ganancia >= 0 ? 'good' : 'danger'}"><div class="n">${money(ganancia)}</div><div class="l">Ganancia neta</div></div>
        <div class="sr-stat"><div class="n">${totalCuentas}</div><div class="l">Cuentas totales</div></div>
        <div class="sr-stat"><div class="n">${(s.gruposInternos || []).length}</div><div class="l">Grupos</div></div>
      </div>
      <div class="svc-kv" style="padding:0;">
        <div class="svc-kv-row"><span class="svc-kv-label">Costo fijo mensual</span><span class="svc-kv-value">${money(s.costoMensual)}</span></div>
        <div class="svc-kv-row"><span class="svc-kv-label">Precio por usuario</span><span class="svc-kv-value">${money(s.precioMensual)}</span></div>
        <div class="svc-kv-row"><span class="svc-kv-label">Cuentas por grupo</span><span class="svc-kv-value">${(s.gruposInternos && s.gruposInternos.length > 0) ? s.gruposInternos[0].cantidadCuentas : 1}</span></div>
      </div>
      ${ocultarTitulo ? '' : `
      <div style="margin-top:8px;">
        <div class="sr-subhead">Grupos internos</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">
          ${(s.gruposInternos || []).map(g => `<span class="badge badge-neutral">${g.nombre} (${g.cantidadCuentas})</span>`).join('') || '<span style="font-size:12px;color:#999;">Sin grupos</span>'}
        </div>
        <div style="margin-top:6px;">
          <div class="sr-subhead">Campos personalizados</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;">
            ${(s.camposPersonalizados || []).map(c => `<span class="badge badge-neutral">${c}</span>`).join('') || '<span style="font-size:12px;color:#999;">Sin campos</span>'}
          </div>
        </div>
      </div>`}
    </div>
  `;
}

/* ---- Tarjeta de usuario (solo lectura) ---- */
function tarjetaUsuarioRapida(u, ocultarTitulo) {
  const total = u.servicios.reduce((acc, a) => acc + (Number(a.precio) || 0), 0);
  const periodo = periodoActual();
  const hoyDia = new Date().getDate();
  const historial = db.pagos.filter(p => p.usuarioId === u.id).sort((a, b) => b.periodo.localeCompare(a.periodo));

  let pagados = 0, pendientes = 0, vencidos = 0;
  u.servicios.forEach(a => {
    const pago = pagoRegistrado(u.id, a.servicioId, periodo);
    if (pago) pagados++;
    else if (u.diaPago && hoyDia > Number(u.diaPago)) vencidos++;
    else pendientes++;
  });

  return `
    <div class="sr-card" data-usuario-card="${u.id}">
      ${ocultarTitulo ? '' : `
      <div class="sr-card-head">
        <span class="sr-card-title">${u.nombre}</span>
        <button class="btn btn-outline btn-sm" data-usr-editar="${u.id}">Editar</button>
      </div>`}
      <div class="sr-stats-row">
        <div class="sr-stat good"><div class="n">${money(total)}</div><div class="l">Total mensual</div></div>
        <div class="sr-stat"><div class="n">${u.servicios.length}</div><div class="l">Servicios</div></div>
        <div class="sr-stat ${pagados > 0 ? 'good' : ''}"><div class="n">${pagados}</div><div class="l">Pagados</div></div>
        <div class="sr-stat ${vencidos > 0 ? 'danger' : (pendientes > 0 ? 'warn' : '')}"><div class="n">${vencidos + pendientes}</div><div class="l">Por cobrar</div></div>
      </div>
      <div class="svc-kv" style="padding:0;">
        <div class="svc-kv-row"><span class="svc-kv-label">Teléfono</span><span class="svc-kv-value${u.telefono ? '' : ' muted'}">${u.telefono || 'Sin especificar'}</span></div>
        <div class="svc-kv-row"><span class="svc-kv-label">Día de pago</span><span class="svc-kv-value">${u.diaPago}</span></div>
      </div>

      ${u.servicios.length > 0 ? `
      <details class="sr-collapse" data-usr-servicios-tabla="${u.id}">
        <summary>Accesos y credenciales (${u.servicios.length})</summary>
        ${u.servicios.map((a) => {
          const svc = db.servicios.find(x => x.id === a.servicioId);
          const grupo = svc ? (svc.gruposInternos || []).find(g => g.id === a.grupoInternoId) : null;
          const camposPersonalizados = a.valoresPersonalizados || {};
          const svcCampos = svc?.camposPersonalizados || [];
          return `
            <div style="padding:10px 12px; border-top:1px solid #eee;">
              <div style="font-size:12px; font-weight:700; color:#555; margin-bottom:6px;">${svc ? svc.nombre : '?'}</div>
              <div class="svc-kv" style="padding:0;">
                <div class="svc-kv-row"><span class="svc-kv-label">Grupo</span><span class="svc-kv-value">${grupo ? grupo.nombre : '—'}</span></div>
                <div class="svc-kv-row"><span class="svc-kv-label">Precio</span><span class="svc-kv-value">${money(a.precio)}</span></div>
                ${svcCampos.map(c => `<div class="svc-kv-row"><span class="svc-kv-label">${c}</span><span class="svc-kv-value${camposPersonalizados[c] ? '' : ' muted'}">${camposPersonalizados[c] || 'Sin especificar'}</span></div>`).join('')}
              </div>
            </div>
          `;
        }).join('')}
        <div style="padding:10px 12px; border-top:1px solid #eee;">
          <button class="btn btn-outline btn-sm" data-usr-editar="${u.id}">Editar accesos</button>
        </div>
      </details>
      ` : `<div style="font-size:11.5px; color:#999; margin-top:6px;">Sin servicios asociados.</div>`}

      ${u.servicios.length > 0 ? `
      <div class="sr-2col" style="margin-top:14px;">
        <div>
          <div class="sr-subhead">Control de pagos</div>
          <div class="sr-2col-box">
            <table>
              <thead><tr><th>Periodo</th><th>Total</th><th>Estado</th><th>Acción</th></tr></thead>
              <tbody>
                <tr>
                  <td>${periodo}</td>
                  <td>${money(total)}</td>
                  <td>${pagados === u.servicios.length
                    ? '<span class="badge badge-ok">Pagado</span>'
                    : (vencidos > 0 ? '<span class="badge badge-danger">Vencido</span>' : '<span class="badge badge-warn">Pendiente</span>')}
                  </td>
                  <td>${pagados === u.servicios.length
                    ? `<button class="btn btn-outline btn-sm" data-unpay-all="${u.id}">Desmarcar</button>`
                    : `<button class="btn btn-primary btn-sm" data-pay-all="${u.id}">Marcar pagado</button>`}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <div class="sr-subhead">Historial de pagos</div>
          <div class="sr-2col-box">
            ${(() => {
              const porPeriodo = {};
              historial.forEach(p => { porPeriodo[p.periodo] = (porPeriodo[p.periodo] || 0) + (Number(p.monto) || 0); });
              const periodos = Object.keys(porPeriodo).sort((a, b) => b.localeCompare(a));
              if (periodos.length === 0) return `<div class="sr-empty" style="padding:14px;">Sin pagos aún.</div>`;
              return `
                <table>
                  <thead><tr><th>Periodo</th><th>Total pagado</th></tr></thead>
                  <tbody>
                    ${periodos.map(p => `<tr><td>${p}</td><td>${money(porPeriodo[p])}</td></tr>`).join('')}
                  </tbody>
                </table>
              `;
            })()}
          </div>
        </div>
      </div>
      ` : ''}
    </div>
  `;
}

/* ---- Eventos de las tarjetas del dropdown ---- */
function enlazarTarjetasRapidas() {
  searchResults.querySelectorAll('[data-svc-editar]').forEach(btn => {
    btn.addEventListener('click', () => {
      cerrarBusqueda();
      buscadorGlobal.value = '';
      vistaActual = 'servicios';
      servicioSeleccionadoId = btn.dataset.svcEditar;
      document.querySelectorAll('#navMain .nav-item').forEach(x => x.classList.remove('active'));
      document.querySelector('#navMain [data-vista="servicios"]').classList.add('active');
      render();
    });
  });

  searchResults.querySelectorAll('[data-usr-editar]').forEach(btn => {
    btn.addEventListener('click', () => {
      cerrarBusqueda();
      buscadorGlobal.value = '';
      irAUsuario(btn.dataset.usrEditar);
    });
  });

  searchResults.querySelectorAll('[data-pay-all]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const u = db.usuarios.find(x => x.id === btn.dataset.payAll);
      if (!u) return;
      const periodo = periodoActual();
      u.servicios.forEach(s => {
        if (!pagoRegistrado(u.id, s.servicioId, periodo)) {
          db.pagos.push({ id: uid('pago'), usuarioId: u.id, servicioId: s.servicioId, periodo, monto: Number(s.precio) || 0, fecha: new Date().toISOString(), estado: 'pagado' });
        }
      });
      await persist();
      showToast('Pago registrado.');
      if (vistaActual === 'dashboard' || vistaActual === 'pagos') render();
      ejecutarBusqueda();
    });
  });

  searchResults.querySelectorAll('[data-unpay-all]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const u = db.usuarios.find(x => x.id === btn.dataset.unpayAll);
      if (!u) return;
      const periodo = periodoActual();
      db.pagos = db.pagos.filter(p => !(p.usuarioId === u.id && p.periodo === periodo));
      await persist();
      showToast('Pago desmarcado.');
      if (vistaActual === 'dashboard' || vistaActual === 'pagos') render();
      ejecutarBusqueda();
    });
  });
}

buscadorGlobal.addEventListener('input', ejecutarBusqueda);
buscadorGlobal.addEventListener('focus', () => { if (buscadorGlobal.value.trim().length >= 2) ejecutarBusqueda(); });
searchBackdrop.addEventListener('click', cerrarBusqueda);
document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrarBusqueda(); });

document.getElementById('shCloseBtn').addEventListener('click', () => {
  historialPagosVisible = false;
  renderSidebars();
});

document.getElementById('historialTrigger').addEventListener('click', () => {
  historialPagosVisible = !historialPagosVisible;
  renderSidebars();
});

/* =========================================================
   EXPORTAR
========================================================= */
document.getElementById('btnExport').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'streaming-data.json';
  a.click();
  URL.revokeObjectURL(url);
});

/* =========================================================
   INIT (migración)
========================================================= */
async function init() {
  document.getElementById('storageMode').textContent = 'Local (navegador)';
  actualizarReloj();
  setInterval(actualizarReloj, 30000);
  const loaded = await Storage.load();
  if (loaded) {
    db = Object.assign({ servicios: [], usuarios: [], pagos: [] }, loaded);
    db.servicios.forEach(s => {
      if (!s.gruposInternos) {
        if (s.cantidad) {
          s.gruposInternos = [{ id: uid('gpo'), nombre: 'Grupo 1', cantidadCuentas: Number(s.cantidad) }];
        } else {
          s.gruposInternos = [{ id: uid('gpo'), nombre: 'Grupo 1', cantidadCuentas: 1 }];
        }
        delete s.cantidad;
        delete s.grupoId;
      }
      db.usuarios.forEach(u => {
        u.servicios.forEach(a => {
          if (a.servicioId === s.id && !a.grupoInternoId) {
            if (s.gruposInternos && s.gruposInternos.length > 0) {
              a.grupoInternoId = s.gruposInternos[0].id;
            }
          }
        });
      });
    });
    await persist();
  }
  render();
}
init();
