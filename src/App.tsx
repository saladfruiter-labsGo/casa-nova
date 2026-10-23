import { useEffect, useState } from 'react'
import { NavLink, Route, Routes, useLocation, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, Home, LayoutGrid, Settings, ShoppingCart } from 'lucide-react'
import { api } from './lib/api'
import { Spinner } from './components/ui'
import Login from './pages/Login'
import Overview from './pages/Overview'
import Products from './pages/Products'
import ProductNew from './pages/ProductNew'
import ProductDetail from './pages/ProductDetail'
import ProductEdit from './pages/ProductEdit'
import Purchases from './pages/Purchases'
import Alerts from './pages/Alerts'
import SettingsPage from './pages/Settings'

const NAV = [
  { to: '/', label: 'Visão geral', icon: Home, end: true },
  { to: '/produtos', label: 'Produtos', icon: LayoutGrid },
  { to: '/compras', label: 'Compras', icon: ShoppingCart },
  { to: '/alertas', label: 'Alertas', icon: Bell },
]

export default function App() {
  const qc = useQueryClient()
  const [authed, setAuthed] = useState<boolean | null>(null)
  useEffect(() => {
    api('/api/auth/me')
      .then(() => setAuthed(true))
      .catch(() => setAuthed(false))
    const onUnauth = () => {
      setAuthed(false)
      qc.clear()
    }
    window.addEventListener('cn:unauthorized', onUnauth)
    return () => window.removeEventListener('cn:unauthorized', onUnauth)
  }, [qc])
  if (authed === null) return <Spinner />
  if (!authed) return <Login onLogin={() => setAuthed(true)} />
  return <Shell />
}

function Shell() {
  const { pathname } = useLocation()
  const { data: dash } = useQuery({ queryKey: ['dashboard'], queryFn: () => api<{ unread_alerts: number }>('/api/dashboard'), refetchInterval: 60_000 })
  const unread = dash?.unread_alerts ?? 0
  useEffect(() => window.scrollTo(0, 0), [pathname])

  return (
    <div className="min-h-screen pb-[calc(76px+env(safe-area-inset-bottom))] sm:pb-10">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2">
        Pular para o conteúdo
      </a>
      <header className="sticky top-0 z-30 border-b border-stone-200/70 bg-stone-50/85 backdrop-blur dark:border-stone-800 dark:bg-stone-950/85">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 sm:h-16 sm:px-6">
          <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <img src="/icon.svg" alt="" className="h-7 w-7" />
            <span>Casa Nova</span>
          </Link>
          <nav aria-label="Principal" className="hidden flex-1 items-center gap-1 sm:flex">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  `relative flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                    isActive ? 'bg-brand-50 text-brand-800 dark:bg-brand-900/40 dark:text-brand-300' : 'text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white'
                  }`
                }
              >
                <n.icon className="h-4 w-4" aria-hidden />
                {n.label}
                {n.to === '/alertas' && unread > 0 && (
                  <span className="rounded-full bg-brand-600 px-1.5 text-[11px] font-semibold leading-5 text-white" aria-label={`${unread} não lidos`}>
                    {unread}
                  </span>
                )}
              </NavLink>
            ))}
          </nav>
          <NavLink
            to="/configuracoes"
            className={({ isActive }) => `btn-ghost ml-auto px-2.5 ${isActive ? 'bg-stone-200/70 dark:bg-stone-800' : ''}`}
            aria-label="Configurações"
            title="Configurações"
          >
            <Settings className="h-5 w-5" aria-hidden />
          </NavLink>
        </div>
      </header>

      <main id="conteudo" className="mx-auto max-w-6xl px-4 pt-6 sm:px-6 sm:pt-8">
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/produtos" element={<Products />} />
          <Route path="/produtos/novo" element={<ProductNew />} />
          <Route path="/produtos/:id" element={<ProductDetail />} />
          <Route path="/produtos/:id/editar" element={<ProductEdit />} />
          <Route path="/compras" element={<Purchases />} />
          <Route path="/alertas" element={<Alerts />} />
          <Route path="/configuracoes" element={<SettingsPage />} />
          <Route path="*" element={<p className="muted">Página não encontrada.</p>} />
        </Routes>
      </main>

      {/* navegação inferior no celular */}
      <nav
        aria-label="Principal"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-stone-800 dark:bg-stone-900/95 sm:hidden"
      >
        <div className="grid grid-cols-4">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `relative flex min-h-[60px] flex-col items-center justify-center gap-1 text-[11px] font-medium ${
                  isActive ? 'text-brand-700 dark:text-brand-400' : 'text-stone-500 dark:text-stone-400'
                }`
              }
            >
              <span className="relative">
                <n.icon className="h-5 w-5" aria-hidden />
                {n.to === '/alertas' && unread > 0 && (
                  <span className="absolute -right-2 -top-1.5 rounded-full bg-brand-600 px-1 text-[10px] font-semibold leading-4 text-white">{unread}</span>
                )}
              </span>
              {n.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
