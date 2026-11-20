package days

import "fmt"

// Error is a client-facing failure with a stable code for the UI.
type Error struct {
	Code    string
	Message string
}

func (e *Error) Error() string { return e.Code + ": " + e.Message }

func fail(code, message string, args ...any) *Error {
	if len(args) > 0 {
		message = fmt.Sprintf(message, args...)
	}
	return &Error{Code: code, Message: message}
}

const (
	CodeInvalidMeta        = "invalid_meta"
	CodeInvalidPhotoCount  = "invalid_photo_count"
	CodeUnsupportedPhoto   = "unsupported_photo"
	CodePhotoTooLarge      = "photo_too_large"
	CodeUnsupportedAudio   = "unsupported_audio"
	CodeAudioTooLarge      = "audio_too_large"
	CodeAudioDuration      = "audio_duration"
	CodePayloadTooLarge    = "payload_too_large"
	CodeUnauthorized       = "unauthorized"
	CodeNotFound           = "not_found"
	CodePreconditionFailed = "precondition_failed"
	CodeIDConflict         = "id_conflict"
	CodeQuotaExceeded      = "quota_exceeded"
)
