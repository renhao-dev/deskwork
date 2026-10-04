import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api.ts'
import { viewTimer } from '../../shared/timer.ts'
import type { ItemType } from '../../shared/types.ts'

export const keys = {
  me: ['me'] as const,
  dashboard: ['dashboard'] as const,
  goals: ['goals'] as const,
  tasks: ['tasks'] as const,
  resources: ['resources'] as const,
  folders: ['folders'] as const,
  detail: (type: ItemType, id: number) => ['detail', type, id] as const,
  history: ['history'] as const,
  users: ['users'] as const,
  note: (id: number) => ['note', id] as const,
  notes: (type: ItemType, id: number, trash = false) => ['notes', type, id, trash] as const,
}

export const useMe = () => useQuery({ queryKey: keys.me, queryFn: api.me, retry: false, staleTime: Infinity })

// Refetching regularly picks up the day rollover and changes from other tabs.
export const useDashboard = () => useQuery({ queryKey: keys.dashboard, queryFn: api.dashboard, refetchInterval: 60_000 })
export const useGoals = () => useQuery({ queryKey: keys.goals, queryFn: api.goals })
export const useTasks = () => useQuery({ queryKey: keys.tasks, queryFn: api.tasks })
export const useResources = () => useQuery({ queryKey: keys.resources, queryFn: api.resources })
export const useFolders = () => useQuery({ queryKey: keys.folders, queryFn: api.folders })
export const useDetail = (type: ItemType, id: number, enabled = true) =>
  useQuery({ queryKey: keys.detail(type, id), queryFn: () => api.detail(type, id), enabled })

/** Invalidate everything that shows items, time or history. */
export function useRefreshAll() {
  const qc = useQueryClient()
  return () => {
    for (const k of [keys.dashboard, keys.goals, keys.tasks, keys.history, ['detail']]) qc.invalidateQueries({ queryKey: k })
  }
}

/** A mutation that refreshes all item data when it settles. */
export function useAction<A, R>(fn: (arg: A) => Promise<R>, onSuccess?: (r: R, a: A) => void) {
  const refresh = useRefreshAll()
  return useMutation({ mutationFn: fn, onSuccess, onSettled: refresh })
}

export function useNow(intervalMs = 1000, active = true) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs, active])
  return now
}

/** The live timer, recomputed every second from the stored timestamps. */
export function useTimerView() {
  const { data } = useDashboard()
  const timer = data?.timer ?? null
  const now = useNow(1000, !!timer && timer.status === 'running')
  return timer ? viewTimer(timer, Math.max(now, Date.now())) : null
}
