import axios from "axios";
import * as cookie from 'cookie';
import path from "path";
import * as os from "node:os";
import * as fs from "node:fs/promises";
import 'dotenv/config'
import * as t from "io-ts";
import { either } from "fp-ts";
import { function as pipe } from "fp-ts";
import { formatValidationErrors } from "io-ts-reporters";

// File called from the cypress setup in cypress-setup.sh
const [EMAIL, PASSWORD] = [process.env.CMSRP_EMAIL, process.env.CMSRP_PWD];
const CYPRESS_URL = "prismic.io";
const scopedDirectory = os.homedir()
const SLICE_MACHINE_USER_AGENT = "slice-machine";
const COOKIE_SEPARATOR = "; ";
const PERSISTED_AUTH_STATE_FILE_NAME = ".prismic";
const AUTH_COOKIE_KEY = "prismic-auth";
const DEFAULT_PERSISTED_AUTH_STATE: PrismicAuthState = {
	base: "https://prismic.io",
	cookies: {},
};
const SESSION_COOKIE_KEY = "SESSION";
const PrismicAuthState = t.intersection([
	t.type({
		base: t.string,
		cookies: t.intersection([
			t.partial({
				[AUTH_COOKIE_KEY]: t.string,
				SESSION: t.string,
			}),
			t.record(t.string, t.string),
		]),
	}),
	t.partial({
		shortId: t.string,
		intercomHash: t.string,
		oauthAccessToken: t.string,
		authUrl: t.string,
	}),
]);
export type PrismicAuthState = t.TypeOf<typeof PrismicAuthState>;
const API_ENDPOINTS = {
    PrismicWroom: "https://prismic.io/",
    PrismicAuthentication: "https://auth.prismic.io/",
    PrismicModels: "https://customtypes.prismic.io/",
    PrismicUser: "https://user-service.prismic.io/",
    AwsAclProvider:
        "https://0yyeb2g040.execute-api.us-east-1.amazonaws.com/prod/",
    PrismicOembed: "https://oembed.prismic.io",
    PrismicUnsplash: "https://unsplash.prismic.io",
    SliceMachineV1: "https://sm-api.prismic.io/v1/",
}
const PrismicUserProfile = t.exact(
    t.type({
        userId: t.string,
        shortId: t.string,
        intercomHash: t.string,
        email: t.string,
        firstName: t.string,
        lastName: t.string,
    }),
);

export class SliceMachineError extends Error {
    name = "SMSliceMachineError";
}
export class UnexpectedDataError extends SliceMachineError {
    name = "SMUnexpectedDataError" as const;
}
export class InternalError extends SliceMachineError {
    name = "SMInternalError" as const;
}
export default async function getAuth() {
    const parsedCookies = await axios
        .post(`https://${CYPRESS_URL}/authentication/signin`, {
            email: EMAIL,
            password: PASSWORD,
        })
        .then((response) => {
            const cookies = response.headers["set-cookie"]!.join("; ");
            const parsedCookies = parseCookies(cookies)
            return parsedCookies
        })
        .catch((e) => {
            console.error("[AUTH]: ", e.message);
            console.error(e);
        });
    const authToken = parsedCookies[AUTH_COOKIE_KEY]
    const sessionToken = parsedCookies[SESSION_COOKIE_KEY]
    const authStateFilePath = path.resolve(scopedDirectory, ".prismic");
    const profile = await _getProfileForAuthenticationToken({
        authToken,
    });

    const authState = await _readPersistedAuthState();

    // Set the auth's URL base to the current base at runtime.
    authState.base = API_ENDPOINTS.PrismicWroom;
    authState.cookies = {
        ...authState.cookies,
        "prismic-auth":authToken,
        "SESSION": sessionToken
    };
    authState.shortId = profile.shortId;
    authState.intercomHash = profile.intercomHash;
    await _writePersistedAuthState(authState)
    const updatedAuthState = await _readPersistedAuthState();
}

async function _getProfileForAuthenticationToken(
    args,
) {
    const url = new URL("./profile", API_ENDPOINTS.PrismicUser);
    const res = await fetch(url.toString(), {
        headers: {
            Authorization: `Bearer ${args.authToken}`,
            "User-Agent": SLICE_MACHINE_USER_AGENT,
        },
    });

    if (res.ok) {
        const json = await res.json();
        const { value: profile, error } = decode(PrismicUserProfile, json);

        if (error) {
            throw new UnexpectedDataError(
                "Received invalid data from the Prismic user service.",
            );
        }

        return profile;
    } else {
        const text = await res.text();
        throw new InternalError(
            "Failed to retrieve profile from the Prismic user service." +
            {
                cause: text,
            },
        );
    }
}

export type DecodeReturnType<A, _O, I> =
    | {
        value: A;
        error?: never;
    }
    | {
        value?: never;
        error: DecodeError<I>;
    };

export const decode = <A, O, I>(
    codec: t.Type<A, O, I>,
    input: I,
): DecodeReturnType<A, O, I> => {
    return pipe.pipe(
        codec.decode(input),
        either.foldW(
            (errors) => {
                return {
                    error: new DecodeError({ input, errors }),
                };
            },
            (value) => {
                return {
                    value,
                };
            },
        ),
    );
};

type DecodeErrorConstructorArgs<TInput = unknown> = {
    input: TInput;
    errors: t.Errors;
};

export class DecodeError<TInput = unknown> extends Error {
    name = "DecodeError";
    input: TInput;
    errors: string[];

    constructor(args: DecodeErrorConstructorArgs<TInput>) {
        const formattedErrors = formatValidationErrors(args.errors);

        super(formattedErrors.join(", "));

        this.input = args.input;
        this.errors = formattedErrors;
    }
}

async function _writePersistedAuthState(
    authState,
): Promise<void> {
    const authStateFilePath = _getPersistedAuthStateFilePath();

    const preparedAuthState = {
        ...authState,
        cookies: serializeCookies(authState.cookies),
    };

    try {
        await fs.writeFile(
            authStateFilePath,
            JSON.stringify(preparedAuthState, null, 2),
        );
    } catch (error) {
        throw new InternalError(
            "Failed to write Prismic authentication state to the file system."+
            {
                cause: error,
            },
        );
    }
}

export const serializeCookies = (
	cookies,
	args : SerializeCookiesArgs = {},
): string => {
	const cookiesToSerialize = {
		...castParsedCookies(args.cookieJar || {}),
		...castParsedCookies(cookies),
	};

	const items: string[] = [];

	for (const name in cookiesToSerialize) {
		items.push(
			cookie.serialize(name, cookiesToSerialize[name], {
				// Cookies need be stored raw (not encoded or escaped), so that consumers can format them the way they want them to be formatted.
				encode: (cookie) => cookie,
			}),
		);
	}

	return items.join(COOKIE_SEPARATOR);
};


function _getPersistedAuthStateFilePath(): string {
    return path.resolve(scopedDirectory, PERSISTED_AUTH_STATE_FILE_NAME);
}

const castParsedCookies = (cookies): Record<string, string> => {
	if (Array.isArray(cookies)) {
		return cookie.parse(cookies.join(COOKIE_SEPARATOR));
	} else if (typeof cookies === "string") {
		return cookie.parse(cookies);
	} else {
		return cookies;
	}
};

type SerializeCookiesArgs = {
	cookieJar?;
};

async function _readPersistedAuthState(): Promise<PrismicAuthState> {
    const authStateFilePath = _getPersistedAuthStateFilePath();

    let authStateFileContents: string = JSON.stringify({});
    let rawAuthState: Record<string, unknown> = {};

    try {
        authStateFileContents = await fs.readFile(authStateFilePath, "utf8");
        rawAuthState = JSON.parse(authStateFileContents);
    } catch {
        // Write a default persisted state if it doesn't already exist.

        rawAuthState = {
            ...DEFAULT_PERSISTED_AUTH_STATE,
            cookies: serializeCookies(DEFAULT_PERSISTED_AUTH_STATE.cookies),
        };
        authStateFileContents = JSON.stringify(rawAuthState, null, "\t");

        await fs.mkdir(path.dirname(authStateFilePath), { recursive: true });
        await fs.writeFile(authStateFilePath, authStateFileContents);
    }

    // Decode cookies into a record for convenience.
    if (typeof rawAuthState.cookies === "string") {
        rawAuthState.cookies = parseCookies(rawAuthState.cookies);
    }

    const { value: authState, error } = decode(PrismicAuthState, rawAuthState);

    if (error) {
        throw new UnexpectedDataError("Prismic authentication state is invalid.");
    }

    return authState;
}

const parseCookies = (cookies: string): Record<string, string> => {
	return cookie.parse(cookies, {
		// Don't escape any values.
		decode: (value) => value,
	});
};

export async function checkIsLoggedIn(): Promise<boolean> {
    const authState = await _readPersistedAuthState();

    if (checkHasAuthenticationToken(authState)) {
        const url = new URL("./validate", API_ENDPOINTS.PrismicAuthentication);
        url.searchParams.set("token", authState.cookies[AUTH_COOKIE_KEY]);

        let res;
        try {
            res = await fetch(url.toString(), {
                headers: {
                    "User-Agent": SLICE_MACHINE_USER_AGENT,
                },
            });
        } catch (error) {
            // Noop, we return if `res` is not defined.
        }

        if (!res || !res.ok) {
            await this.logout();

            return false;
        }

        return true;
    } else {
        return false;
    }
}

const checkHasAuthenticationToken = (
	authState: PrismicAuthState,
): authState is PrismicAuthState & {
	cookies: Required<
		Pick<
			PrismicAuthState["cookies"],
			typeof AUTH_COOKIE_KEY | typeof SESSION_COOKIE_KEY
		>
	>;
} => {
	return Boolean(
		authState.cookies[AUTH_COOKIE_KEY] && authState.cookies[SESSION_COOKIE_KEY],
	);
};

//Execution Stack
console.log(os.homedir());
(getAuth()).then(async () => {
    const isLoggedIn = await checkIsLoggedIn()
    console.log(isLoggedIn)
}
)

//npx @slicemachine/init@latest -r website-factory-template