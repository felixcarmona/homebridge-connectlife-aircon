.PHONY: clean lint build

lint:
	npx tsc --noEmit

clean:
	rm -rf dist

build: lint clean
	npx tsc
