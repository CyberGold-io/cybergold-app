SHELL := /bin/bash

.PHONY: validate-env

validate-env:
	@npm run validate:env
