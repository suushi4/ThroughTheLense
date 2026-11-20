package days

// FailAfterBlobs makes Save fail after files are committed but before the
// database write, to test that nothing is left behind.
func FailAfterBlobs(s *Service, err error) { s.afterBlob = func() error { return err } }
