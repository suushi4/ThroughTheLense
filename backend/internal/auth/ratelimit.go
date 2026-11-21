package auth

import (
	"sync"
	"time"
)

// Limiter is a sliding one-minute window per key. account_server.py counts
// per process; keying by client address gives the same result locally (one
// client) and stops one visitor from locking everyone out when deployed.
type Limiter struct {
	mu      sync.Mutex
	limit   int
	window  time.Duration
	now     func() time.Time
	hits    map[string][]time.Time
	checked int
}

func NewLimiter(limit int, window time.Duration) *Limiter {
	return &Limiter{limit: limit, window: window, now: time.Now, hits: map[string][]time.Time{}}
}

// Allow records an attempt for key and reports whether it is within limit.
func (l *Limiter) Allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	cutoff := now.Add(-l.window)
	if l.checked++; l.checked%1024 == 0 {
		for k, times := range l.hits {
			if len(times) == 0 || !times[len(times)-1].After(cutoff) {
				delete(l.hits, k)
			}
		}
	}
	times := l.hits[key]
	i := 0
	for i < len(times) && !times[i].After(cutoff) {
		i++
	}
	times = times[i:]
	if len(times) >= l.limit {
		l.hits[key] = times
		return false
	}
	l.hits[key] = append(times, now)
	return true
}
