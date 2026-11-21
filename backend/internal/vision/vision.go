// Package vision asks Claude which «звуки места» a cover photo suggests.
// The photo is sent once and kept nowhere: not on disk, not in logs.
package vision

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/anthropics/anthropic-sdk-go/v2"
	"github.com/anthropics/anthropic-sdk-go/v2/option"
)

// Sound is one tag the model may return, described in plain words.
type Sound struct {
	ID          string
	Description string
}

// Sounds mirrors ambienceLibrary in web/ambience.mjs.
var Sounds = []Sound{
	{"rain", "rain is falling, umbrellas, rain drops, a storm"},
	{"wet-asphalt", "wet road or pavement, puddles, reflections after rain"},
	{"street-traffic", "a city street with cars, buses, trams or a bus stop"},
	{"park-birds", "a park, garden, trees or forest in daylight where birds would sing"},
	{"crowd-talk", "many people together: a square, market, station, festival, crowd"},
	{"cafe", "a cafe, restaurant or bar, cups, a table with drinks or food"},
	{"wind", "strong wind: bending trees, blowing hair or snow, open exposed places"},
	{"indoor-quiet", "a quiet room indoors: home, a desk, an empty hall or stage"},
	{"stream", "running water: a stream, river, waterfall, fountain, melting snow"},
}

// Tag is a sound with the model's confidence in 0..1.
type Tag struct {
	ID         string  `json:"id"`
	Confidence float64 `json:"confidence"`
}

// Model is the Claude model used for tagging.
const Model = "claude-opus-5-5"

var ErrRefused = errors.New("the model declined to tag the photo")

type Tagger struct {
	client  anthropic.Client
	timeout time.Duration
	schema  json.RawMessage
	prompt  string
}

// New returns a tagger for the API key, or nil when there is no key.
// Extra options (a test base URL) are passed to the client.
func New(apiKey string, timeout time.Duration, opts ...option.RequestOption) *Tagger {
	if apiKey == "" {
		return nil
	}
	ids := make([]string, len(Sounds))
	var list strings.Builder
	for i, s := range Sounds {
		ids[i] = s.ID
		fmt.Fprintf(&list, "- %s: %s\n", s.ID, s.Description)
	}
	enum, _ := json.Marshal(ids)
	schema := json.RawMessage(`{"type":"object","additionalProperties":false,"required":["tags"],"properties":{"tags":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["id","confidence"],"properties":{"id":{"type":"string","enum":` + string(enum) + `},"confidence":{"type":"number"}}}}}}`)
	prompt := "This photo is the cover of a personal diary entry. The app plays quiet looped background sounds under the entry's song. " +
		"Choose which of these sounds the place in the photo would plausibly have:\n" + list.String() +
		"Use only what is visible or strongly implied by the scene. Return at most three tags with a confidence from 0 to 1. " +
		"Return an empty list when nothing fits, for example a close-up of an object with no sense of place. Do not describe people."
	return &Tagger{
		client:  anthropic.NewClient(append([]option.RequestOption{option.WithAPIKey(apiKey), option.WithMaxRetries(0)}, opts...)...),
		timeout: timeout,
		schema:  schema,
		prompt:  prompt,
	}
}

// Tags asks for the sounds of one image (JPEG, PNG or WebP bytes).
func (t *Tagger) Tags(ctx context.Context, image []byte, mediaType string) ([]Tag, error) {
	ctx, cancel := context.WithTimeout(ctx, t.timeout)
	defer cancel()
	resp, err := t.client.Beta.Messages.New(ctx, anthropic.BetaMessageNewParams{
		Model:     Model,
		MaxTokens: 2048,
		// Classification: low effort keeps it fast; thinking stays adaptive.
		OutputConfig: anthropic.BetaOutputConfigParam{
			Effort: anthropic.BetaOutputConfigEffortLow,
			Format: anthropic.BetaJSONOutputFormatParam{Schema: t.schema},
		},
		// On a policy decline the API retries the same request on a
		// fallback model inside this call.
		Fallbacks: anthropic.BetaFallbacksParamOfDefault(),
		Betas:     []anthropic.AnthropicBeta{anthropic.AnthropicBetaServerSideFallback2026_07_01},
		Messages: []anthropic.BetaMessageParam{anthropic.NewBetaUserMessage(
			anthropic.NewBetaImageBlock(anthropic.BetaBase64ImageSourceParam{
				Data:      base64.StdEncoding.EncodeToString(image),
				MediaType: anthropic.BetaBase64ImageSourceMediaType(mediaType),
			}),
			anthropic.NewBetaTextBlock(t.prompt),
		)},
	})
	if err != nil {
		return nil, err
	}
	if resp.StopReason == anthropic.BetaStopReasonRefusal {
		return nil, ErrRefused
	}
	for _, block := range resp.Content {
		if text, ok := block.AsAny().(anthropic.BetaTextBlock); ok {
			var out struct {
				Tags []Tag `json:"tags"`
			}
			if err := json.Unmarshal([]byte(text.Text), &out); err != nil {
				return nil, fmt.Errorf("tag response: %w", err)
			}
			return Clean(out.Tags), nil
		}
	}
	return nil, errors.New("tag response had no text")
}

// Clean keeps known ids once each, confidence clamped to 0..1, at most three.
func Clean(tags []Tag) []Tag {
	known := map[string]bool{}
	for _, s := range Sounds {
		known[s.ID] = true
	}
	seen := map[string]bool{}
	out := []Tag{}
	for _, t := range tags {
		if !known[t.ID] || seen[t.ID] {
			continue
		}
		seen[t.ID] = true
		t.Confidence = min(1, max(0, t.Confidence))
		out = append(out, t)
		if len(out) == 3 {
			break
		}
	}
	return out
}
