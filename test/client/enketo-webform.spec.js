import i18next from 'i18next';
import lodash from 'lodash';
import applicationCache from '../../public/js/src/module/application-cache';
import connection from '../../public/js/src/module/connection';
import controller from '../../public/js/src/module/controller-webform';
import event from '../../public/js/src/module/event';
import formCache from '../../public/js/src/module/form-cache';
import gui from '../../public/js/src/module/gui';
import settings from '../../public/js/src/module/settings';
import store from '../../public/js/src/module/store';

/**
 * @typedef {import('sinon').SinonStub<Args, Return>} Stub
 * @template Args
 * @template Return
 */

/**
 * @typedef {import('sinon').SinonSandbox} Sandbox
 */

/**
 * @typedef {import('../../app/models/survey-model').SurveyObject} Survey
 */

/** @type {Record<string, any> | null} */
let webformPrivate = null;

describe( 'Enketo webform app', () => {
    /** @type {string} */
    let enketoId;

    /** @type {Record<string, string>} */
    let defaults;

    /** @type {Sandbox} */
    let sandbox;

    /** @type {import('sinon').SinonFakeTimers} */
    let timers;

    /** @type {HTMLElement} */
    let mainElement = null;

    before( async () => {
        const formHeader = document.querySelector( '.form-header' );

        if ( formHeader == null ) {
            const domParser = new DOMParser();
            const formDOM = domParser.parseFromString( `
                <div class="main">
                    <div class="paper">
                        <div class="form-header"></div>
                    </div>
                </div>
            `, 'text/html' );

            mainElement = formDOM.documentElement.querySelector( '.main' );

            document.body.appendChild( mainElement );
        }

        const { _PRIVATE_TEST_ONLY_ } = await import( '../../public/js/src/enketo-webform' );

        webformPrivate = _PRIVATE_TEST_ONLY_;
    } );

    beforeEach( async () => {
        sandbox = sinon.createSandbox();
        timers = sinon.useFakeTimers();

        enketoId = 'surveyA';
        defaults = {};
    } );

    afterEach( () => {
        sandbox.restore();
        timers.clearInterval();
        timers.clearTimeout();
        timers.restore();
    } );

    after( () => {
        if ( mainElement != null ) {
            document.body.removeChild( mainElement );
        }
    } );

    describe( 'initialization steps', () => {
        /**
         * @typedef MockGetter
         * @property {string} description
         * @property {'get'} stubMethod
         * @property {object} object
         * @property {PropertyKey} key
         * @property {any} propertyValue
         */

        /**
         * @typedef ExpectSetter
         * @property {string} description
         * @property {'set'} stubMethod
         * @property {object} object
         * @property {PropertyKey} key
         * @property {any} expectedValue
         */

        /**
         * @typedef MockExpectedCall
         * @property {string} description
         * @property {'callsFake'} stubMethod
         * @property {object} object
         * @property {PropertyKey} key
         * @property {any[]} expectedArgs
         * @property {any} returnValue
         */

        /** @typedef {MockGetter | ExpectSetter | MockExpectedCall} InitStepOptions */

        /** @typedef {InitStepOptions['stubMethod']} InitStepStubMethod */

        /**
         * @typedef Resolvable
         * @property {() => Promise<void>} resolveStep
         * @property {(error: Error) => Promise<void>} rejectStep
         */

        /**
         * @typedef {InitStepOptions & Resolvable} InitStep
         */

        /**
         * @typedef PreparedStepCache
         * @property {Stub<any, any>} stub
         * @property {InitStep[]} queue
         */

        /** @type {Partial<Survey>} */
        let surveyInitData;

        /** @type {Map<object, Record<PropertyKey, PreparedStepCache>>} */
        let preparedStepsCache;

        /** @type {InitStep[]} */
        let performedSteps;

        class ParameterPredicate {
            constructor( predicate ) {
                this.predicate = predicate;
            }

            check( actual ) {
                expect( actual ).to.satisfy( this.predicate );
            }
        }

        /**
         * Creates a predicate to determine whether a value is of the
         * specified type.
         *
         * @param {string} expected
         */
        const expectTypeof = ( expected ) => (
            new ParameterPredicate( ( actual => typeof actual === expected ) )
        );

        const expectFunction = expectTypeof( 'function' );
        const expectObject = expectTypeof( 'object' );

        /**
         * Creates a predicate to determine that a callback was provided,
         * and call it when provided.
         */
        const expectCallback = new ParameterPredicate( ( callback ) => {
            if ( typeof callback === 'function' ) {
                callback();

                return true;
            }

            return false;
        } );

        /**
         * Creates a predicate to determine if a translator URL was provided.
         *
         * @param {string} expected
         */
        const expectLanguage = ( expected ) => (
            new ParameterPredicate( lang => lang.includes( `/${expected}/` ) )
        );

        /**
         * @param {object} object
         * @param {PropertyKey} key
         * @return {PreparedStepCache}
         */
        const getPreparedStep = ( object, key ) => {
            let objectCache = preparedStepsCache.get( object );

            if ( objectCache == null ) {
                objectCache = {};

                preparedStepsCache.set( object, objectCache );
            }

            let cache = objectCache[key];

            if ( cache == null ) {
                cache = {
                    queue: [],
                    stub: sandbox.stub( object, key ),
                };

                Object.assign( objectCache, {
                    [key]: cache,
                } );
            }

            return cache;
        };

        const debugLog = ( ...args ) => {
            if ( DEBUG ) {
                console.log( ...args );
            }
        };

        /**
         * Prepares a mocked initialization step which is expected to be performed.
         * Once performed, the step is appeneded to `performedSteps` so that each
         * step, and its order, can be verified.
         *
         * Behavior based on `options.stubMethod`:
         *
         * - 'get': the provided `options.propertyValue` is returned.
         * - 'set': actual set value is compared to the `options.expectedValue`.
         * - 'callsFake': actual arguments are compared to `options.expectedArgs`,
         *   and `options.returnValue` is returned.
         *
         * `options.expectedArgs` items may be:
         *
         * - an instance of `ParameterPredicate`: its predicate will be performed
         *   against the corresponding argument.
         * - any other value: will be compared for deep equality.
         *
         * @param {InitStepOptions} options
         * @return {InitStep}
         */
        const prepareInitStep = ( options ) => {
            const {
                description,
                stubMethod,
                object,
                key,
            } = options;

            let { queue, stub } = getPreparedStep( object, key );

            debugLog( 'Initializing:', description );

            const initStep = {
                options,
                resolveStep( ...args ) {
                    const {
                        description,
                        stubMethod,
                        propertyValue,
                        expectedValue,
                        expectedArgs,
                        returnValue,
                    } = this.options;

                    debugLog( 'Performing:', description );

                    performedSteps.push( this );

                    if ( stubMethod === 'get' ) {
                        return propertyValue;
                    }

                    if ( stubMethod === 'set' ) {
                        return expect( args ).to.deep.equal( [ expectedValue ] );
                    }

                    expect( args.length ).to.equal( expectedArgs.length );

                    for ( const [ index, arg ] of args.entries() ) {
                        const expected = expectedArgs[index];

                        if ( expected instanceof ParameterPredicate ) {
                            expected.check( arg );
                        } else {
                            expect( arg ).to.deep.equal( expected );
                        }
                    }

                    return returnValue;
                },
            };

            queue.push( initStep );

            stub[stubMethod]( ( ...args ) => {
                let step = queue.shift();

                expect( step ).not.to.be.undefined;

                return step.resolveStep( ...args );
            } );

            debugLog( 'Initialized:', description );

            return initStep;
        };


        beforeEach( async () => {
            performedSteps = [];
            preparedStepsCache = new Map();

            enketoId = 'surveyA';
            defaults = {};

            surveyInitData = {
                get enketoId() { return enketoId; },
                get defaults() { return defaults; },
            };

            sandbox.stub( lodash, 'memoize' ).callsFake( fn => fn );
        } );

        describe( 'offline', () => {
            beforeEach( () => {
                sandbox.stub( settings, 'offline' ).get( () => true );
            } );

            it( 'initializes offline forms', async () => {
                enketoId = 'offlineA';

                const xformUrl = 'https://example.com/form.xml';
                const surveyInit = {
                    ...surveyInitData,

                    xformUrl,
                };

                const offlineSurvey = {
                    ...surveyInitData,

                    externalData: [],
                    form: '<form></form>',
                    model: '<a/>',
                    theme: 'kobo',
                };

                const maxSize = 8675309;

                const maxSizeSurvey = {
                    ...offlineSurvey,

                    maxSize,
                };

                const webformInitializedSurvey = {
                    ...maxSizeSurvey,

                    languages: [ 'ar', 'fa' ],
                };

                const updatedMediaSurvey = {
                    ...webformInitializedSurvey,
                    media: [],
                };

                const formElement = document.createElement( 'form' );

                sandbox.stub( i18next, 'use' ).returns( i18next );

                const steps = [
                    prepareInitStep( {
                        description: 'Offline-capable event listener',
                        stubMethod: 'callsFake',
                        object: document,
                        key: 'addEventListener',
                        expectedArgs: [ event.OfflineLaunchCapable().type, expectFunction ],
                    } ),
                    prepareInitStep( {
                        description: 'Application update event listener',
                        stubMethod: 'callsFake',
                        object: document,
                        key: 'addEventListener',
                        expectedArgs: [ event.ApplicationUpdated().type, expectFunction ],
                    } ),
                    prepareInitStep( {
                        description: 'Initialize application cache',
                        stubMethod: 'callsFake',
                        object: applicationCache,
                        key: 'init',
                        expectedArgs: [ surveyInit ],
                        returnValue: Promise.resolve( surveyInit ),
                    } ),
                    prepareInitStep( {
                        description: 'Translator: initialize i18next',
                        stubMethod: 'callsFake',
                        object: i18next,
                        key: 'init',
                        expectedArgs: [ expectObject, expectCallback ],
                    } ),
                    prepareInitStep( {
                        description: 'Initialize form cache',
                        stubMethod: 'callsFake',
                        object: formCache,
                        key: 'init',
                        expectedArgs: [ surveyInit ],
                        returnValue: Promise.resolve( offlineSurvey ),
                    } ),

                    // While there is currently a truthiness check on the query result,
                    // there is a subsequent access outside that check.
                    prepareInitStep( {
                        description: 'Add branding: Ensure a brand image query resolves to an element',
                        stubMethod: 'callsFake',
                        object: document,
                        key: 'querySelector',
                        expectedArgs: [ webformPrivate.BRAND_IMAGE_SELECTOR ],
                        returnValue: document.createElement( 'img' ),
                    } ),

                    prepareInitStep( {
                        description: 'Swap theme',
                        stubMethod: 'callsFake',
                        object: gui,
                        key: 'swapTheme',
                        expectedArgs: [ offlineSurvey ],
                        returnValue: Promise.resolve( offlineSurvey ),
                    } ),
                    prepareInitStep( {
                        description: 'Get/update max submission size',
                        stubMethod: 'callsFake',
                        object: formCache,
                        key: 'updateMaxSubmissionSize',
                        expectedArgs: [ offlineSurvey ],
                        returnValue: Promise.resolve( maxSizeSurvey ),
                    } ),
                    prepareInitStep( {
                        description: 'Assign max submission size to settings',
                        stubMethod: 'set',
                        object: settings,
                        key: 'maxSize',
                        expectedValue: maxSize,
                    } ),
                    prepareInitStep( {
                        description: 'Ensure a query for the page\'s form resolves to an element',
                        stubMethod: 'callsFake',
                        object: document,
                        key: 'querySelector',
                        expectedArgs: [ 'form.or' ],
                        returnValue: formElement,
                    } ),
                    prepareInitStep( {
                        description: 'Initialize controller-webform',
                        stubMethod: 'callsFake',
                        object: controller,
                        key: 'init',
                        expectedArgs: [
                            formElement,
                            {
                                modelStr: maxSizeSurvey.model,
                                instanceStr: null,
                                external: maxSizeSurvey.externalData,
                                survey: maxSizeSurvey,
                            },
                        ],
                        returnValue: Promise.resolve( webformInitializedSurvey ),
                    } ),
                    prepareInitStep( {
                        description: 'Get page title',
                        stubMethod: 'callsFake',
                        object: document,
                        key: 'querySelector',
                        expectedArgs: [ 'head>title' ],
                        returnValue: document.createElement( 'title' ),
                    } ),
                    prepareInitStep( {
                        description: 'Load Arabic translation',
                        stubMethod: 'callsFake',
                        object: globalThis,
                        key: 'fetch',
                        expectedArgs: [ expectLanguage( 'ar' ) ],
                        returnValue: Promise.resolve(),
                    } ),
                    prepareInitStep( {
                        description: 'Load Farsi translation',
                        stubMethod: 'callsFake',
                        object: globalThis,
                        key: 'fetch',
                        expectedArgs: [ expectLanguage( 'fa' ) ],
                        returnValue: Promise.resolve(),
                    } ),
                    prepareInitStep( {
                        description: 'Update form cache media',
                        stubMethod: 'callsFake',
                        object: formCache,
                        key: 'updateMedia',
                        expectedArgs: [ webformInitializedSurvey ],
                        returnValue: Promise.resolve( updatedMediaSurvey ),
                    } ),
                    prepareInitStep( {
                        description: 'Set cache event handlers',
                        stubMethod: 'callsFake',
                        object: document,
                        key: 'addEventListener',
                        expectedArgs: [ event.FormUpdated().type, expectTypeof( 'function' ) ],
                    } ),
                ];

                /** @type {Promise} */
                let offlineInitialization = webformPrivate._initOffline( surveyInit );

                expect( 'xformUrl' in surveyInit ).to.equal( false );

                await offlineInitialization;

                for ( const [ expectedIndex, expectedStep ] of steps.entries() ) {
                    const step = performedSteps.find( performedStep => {
                        return performedStep === expectedStep;
                    } );
                    const index = performedSteps.indexOf( expectedStep );

                    expect( step ).to.equal( expectedStep );
                    expect( index, `Unexpected order of step ${expectedStep.options.description}` )
                        .to.equal( expectedIndex );
                }

                expect( performedSteps.length ).to.equal( steps.length );
            } );
        } );

        describe( 'online', () => {
            beforeEach( () => {
                sandbox.stub( settings, 'offline' ).get( () => false );
            } );

            it( 'initializes online forms', async () => {
                enketoId = 'onlineA';

                const xformUrl = 'https://example.com/form.xml';

                const surveyInit = {
                    ...surveyInitData,
                    xformUrl,
                };

                const onlineSurvey = {
                    ...surveyInitData,

                    externalData: [],
                    form: '<form></form>',
                    model: '<a/>',
                    theme: 'kobo',
                };

                const maxSize = 90120;

                const maxSizeSurvey = {
                    ...onlineSurvey,

                    maxSize,
                };

                const webformInitializedSurvey = {
                    ...maxSize,

                    languages: [ 'ar', 'fa' ],
                };

                const formElement = document.createElement( 'form' );

                const steps = [
                    prepareInitStep( {
                        description: 'Initialize IndexedDB store (used for last-saved instances)',
                        stubMethod: 'callsFake',
                        object: store,
                        key: 'init',
                        expectedArgs: [ { failSilently: true } ],
                        returnValue: Promise.resolve(),
                    } ),
                    prepareInitStep( {
                        description: 'Translator: initialize i18next',
                        stubMethod: 'callsFake',
                        object: i18next,
                        key: 'init',
                        expectedArgs: [ expectObject, expectCallback ],
                    } ),

                    prepareInitStep( {
                        description: 'Get form parts',
                        stubMethod: 'callsFake',
                        object: connection,
                        key: 'getFormParts',
                        expectedArgs: [ surveyInit ],
                        returnValue: Promise.resolve( onlineSurvey ),
                    } ),

                    // While there is currently a truthiness check on the query result,
                    // there is a subsequent access outside that check.
                    prepareInitStep( {
                        description: 'Add branding: Ensure a brand image query resolves to an element',
                        stubMethod: 'callsFake',
                        object: document,
                        key: 'querySelector',
                        expectedArgs: [ webformPrivate.BRAND_IMAGE_SELECTOR ],
                        returnValue: document.createElement( 'img' ),
                    } ),

                    prepareInitStep( {
                        description: 'Swap theme',
                        stubMethod: 'callsFake',
                        object: gui,
                        key: 'swapTheme',
                        expectedArgs: [ onlineSurvey ],
                        returnValue: Promise.resolve( onlineSurvey ),
                    } ),
                    prepareInitStep( {
                        description: 'Get max submission size',
                        stubMethod: 'callsFake',
                        object: connection,
                        key: 'getMaximumSubmissionSize',
                        expectedArgs: [ onlineSurvey ],
                        returnValue: Promise.resolve( maxSizeSurvey ),
                    } ),
                    prepareInitStep( {
                        description: 'Assign max submission size to settings',
                        stubMethod: 'set',
                        object: settings,
                        key: 'maxSize',
                        expectedValue: maxSize,
                    } ),
                    prepareInitStep( {
                        description: 'Ensure a query for the page\'s form resolves to an element',
                        stubMethod: 'callsFake',
                        object: document,
                        key: 'querySelector',
                        expectedArgs: [ 'form.or' ],
                        returnValue: formElement,
                    } ),
                    prepareInitStep( {
                        description: 'Initialize controller-webform',
                        stubMethod: 'callsFake',
                        object: controller,
                        key: 'init',
                        expectedArgs: [
                            formElement,
                            {
                                modelStr: maxSizeSurvey.model,
                                instanceStr: null,
                                external: maxSizeSurvey.externalData,
                                survey: maxSizeSurvey,
                            },
                        ],
                        returnValue: Promise.resolve( webformInitializedSurvey ),
                    } ),
                    prepareInitStep( {
                        description: 'Get page title',
                        stubMethod: 'callsFake',
                        object: document,
                        key: 'querySelector',
                        expectedArgs: [ 'head>title' ],
                        returnValue: document.createElement( 'title' ),
                    } ),
                ];

                /** @type {Promise} */
                let onlineInitialization = webformPrivate._initOnline( surveyInit );

                await onlineInitialization;

                for ( const [ expectedIndex, expectedStep ] of steps.entries() ) {
                    const step = performedSteps.find( performedStep => {
                        return performedStep === expectedStep;
                    } );
                    const index = performedSteps.indexOf( expectedStep );

                    expect( step ).to.equal( expectedStep );
                    expect( index, `Unexpected order of step ${expectedStep.options.description}` )
                        .to.equal( expectedIndex );
                }

                expect( performedSteps.length ).to.equal( steps.length );
            } );
        } );
    } );

    describe( 'initialization behavior', () => {
        /** @type {Survey} */
        let baseSurvey;

        beforeEach( () => {
            enketoId = 'surveyA';

            baseSurvey = {
                get enketoId() { return enketoId; },

                defaults: {},
                externalData: [],
                form: '<form></form>',
                model: '<a/>',
                theme: 'kobo',
                xformUrl: 'https://example.com/form.xml',
            };
        } );

        describe( 'emergency handlers', () => {
            /**
             * @param {number} timeoutMs
             */
            const timeoutRejectionPromise = ( timeoutMs ) => {
                // Defined here to get a reliable stack trace
                const error = new Error( `Promise not resolved in ${timeoutMs} milliseconds` );

                /** @type {Function} */
                let resolver;

                const promise = new Promise( ( resolve, reject ) => {
                    const timeout = setTimeout( () => {
                        reject( error );
                    }, timeoutMs );

                    resolver = ( value ) => {
                        clearTimeout( timeout );
                        resolve( value );
                    };
                } );

                return {
                    promise,
                    resolver,
                };
            };

            /** @type {HTMLButtonElement} */
            let flushButton;

            /** @type {boolean} */
            let isConfirmed;

            /** @type {Promise<boolean> | null} */
            let confirmPromise;

            /** @type {Stub} */
            let confirmStub;

            /** @type {Promise<void> | null} */
            let flushPromise;

            /** @type {Stub} */
            let flushStub;

            /** @type {Promise<void>} */
            let reloadPromise;

            /** @type {Stub} */
            let reloadStub;

            /** @type {Function} */
            let resolveReload;

            beforeEach( () => {
                flushButton = document.createElement( 'button' );

                const querySelector = document.querySelector.bind( document );

                sandbox.stub( document, 'querySelector' ).callsFake( selector => {
                    if ( selector === webformPrivate.FLUSH_BUTTON_SELECTOR ) {
                        return flushButton;
                    }

                    return querySelector( selector );
                } );

                const {
                    resolver: resolveConfirm,
                    promise: confirm,
                } = timeoutRejectionPromise( 100 );

                confirmPromise = confirm;

                confirmStub = sandbox.stub( gui, 'confirm' ).callsFake( () => {
                    resolveConfirm( isConfirmed );

                    return confirmPromise;
                } );

                const {
                    resolver: reloadResolver,
                    promise: reload,
                } = timeoutRejectionPromise( 102 );

                resolveReload = reloadResolver;
                reloadPromise = reload;

                reloadStub = sandbox.stub( webformPrivate._location, 'reload' ).callsFake( () => {
                    resolveReload( true );

                    return reloadPromise;
                } );

                const {
                    resolver: resolveFlush,
                    promise: flush,
                } = timeoutRejectionPromise( 101 );

                flushPromise = flush;

                flushStub = sandbox.stub( store, 'flush' ).callsFake( () => {
                    resolveFlush( true );

                    return flushPromise;
                } );

                sandbox.stub( i18next, 't' ).returnsArg( 0 );

                webformPrivate._setEmergencyHandlers();
            } );

            it( 'flushes the store when confirmed', async () => {
                isConfirmed = true;

                flushButton.dispatchEvent( new Event( 'click' ) );

                expect( confirmStub ).to.have.been.calledWith( {
                    msg: 'confirm.deleteall.msg',
                    heading: 'confirm.deleteall.heading',
                }, {
                    posButton: 'confirm.deleteall.posButton',
                } );

                await Promise.all( [ confirmPromise, timers.tickAsync( 100 ) ] );

                expect( flushStub ).to.have.been.called;

                await Promise.all( [ flushPromise, timers.tickAsync( 101 ) ] );

                await Promise.all( [ reloadPromise, timers.tickAsync( 102 ) ] );

                expect( reloadStub ).to.have.been.called;
            } );

            it( 'does not flush the store when not confirmed', async () => {
                isConfirmed = false;

                flushButton.dispatchEvent( new Event( 'click' ) );

                expect( confirmStub ).to.have.been.calledWith( {
                    msg: 'confirm.deleteall.msg',
                    heading: 'confirm.deleteall.heading',
                }, {
                    posButton: 'confirm.deleteall.posButton',
                } );

                await Promise.all( [ confirmPromise, timers.tickAsync( 100 ) ] );

                expect( flushStub ).not.to.have.been.called;

                await Promise.all( [
                    flushPromise.catch( () => {} ),
                    reloadPromise.catch( () => {} ),
                    timers.tickAsync( 203 ),
                ] );

                expect( reloadStub ).not.to.have.been.called;
            } );
        } );

        describe( 'branding', () => {
            /** @see {@link https://stackoverflow.com/a/13139830} */
            const defaultBrandImageURL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

            /** @see {@link https://stackoverflow.com/a/12483396} */
            const brandImageURL = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

            /** @type {HTMLImageElement | null} */
            let brandImage = null;

            /** @type {boolean} */
            let isOffline;

            /** @type {Survey} */
            let brandedSurvey;

            beforeEach( () => {
                brandImage = document.createElement( 'img' );
                brandImage.setAttribute( 'src', defaultBrandImageURL );
                brandImage.classList.add( 'hide' );

                isOffline = false;

                brandedSurvey = {
                    ...baseSurvey,

                    branding: { source: brandImageURL },
                };

                sandbox.stub( settings, 'offline' ).get( () => isOffline );

                sandbox.stub( document, 'querySelector' ).callsFake( selector => {
                    if ( selector === webformPrivate.BRAND_IMAGE_SELECTOR ) {
                        return brandImage;
                    }

                    throw new Error( `Unexpected selector: ${selector}` );
                } );
            } );

            it( 'sets the brand image source to the survey brand source', () => {
                webformPrivate._addBranding( brandedSurvey );

                expect( brandImage.src ).to.equal( brandImageURL );
            } );

            it( 'sets the brand image data-offline-source to the offline survey brand source', () => {
                isOffline = true;

                webformPrivate._addBranding( brandedSurvey );

                expect( brandImage.getAttribute( 'data-offline-src' ) ).to.equal( brandImageURL );
            } );

            it( 'unsets the brand image src on the offline survey brand source', () => {
                isOffline = true;

                webformPrivate._addBranding( brandedSurvey );

                expect( brandImage.src ).to.equal( '' );
            } );

            it( 'does not set the source if a survey does not have branding', () => {
                webformPrivate._addBranding( baseSurvey );

                expect( brandImage.src ).to.equal( defaultBrandImageURL );
            } );

            it( 'unhides the brand image for a branded survey', () => {
                webformPrivate._addBranding( brandedSurvey );

                expect( brandImage.classList.contains( 'hide' ) ).to.equal( false );
            } );

            it( 'unhides the default brand image for an unbranded survey', () => {
                webformPrivate._addBranding( baseSurvey );

                expect( brandImage.classList.contains( 'hide' ) ).to.equal( false );
            } );

            it( 'does not error when a brand image is not found', () => {
                /** @type {Error | null} */
                let caught = null;

                brandImage = null;

                try {
                    webformPrivate._addBranding( brandImage );
                } catch ( error ) {
                    caught = error;
                }

                expect( caught ).to.equal( null );
            } );
        } );

        describe( 'maximum submission size', () => {
            it( 'sets the survey\'s maximum submission size on settings', () => {
                let maxSizeSetting = 4;

                sandbox.stub( settings, 'maxSize' ).get( () => maxSizeSetting );
                sandbox.stub( settings, 'maxSize' ).set( ( maxSize ) => {
                    maxSizeSetting = maxSize;
                } );

                webformPrivate._updateMaxSizeSetting( {
                    ...baseSurvey,
                    maxSize: 5,
                } );

                expect( maxSizeSetting ).to.equal( 5 );
            } );

            it( 'preserves existing max size setting when survey does not specify a max size', () => {
                let maxSizeSetting = 4;

                sandbox.stub( settings, 'maxSize' ).get( () => maxSizeSetting );
                sandbox.stub( settings, 'maxSize' ).set( ( maxSize ) => {
                    maxSizeSetting = maxSize;
                } );

                webformPrivate._updateMaxSizeSetting( baseSurvey );

                expect( maxSizeSetting ).to.equal( 4 );
            } );
        } );

        describe( 'preparing an existing instance', () => {
            const model = '<instance><data><el1/><el2>default</el2></data><meta><instanceID/></meta></instance>';

            it( 'populates an instance string with provided defaults', () => {
                const result = webformPrivate._prepareInstance( model, {
                    '//instance/data/el1': 'v1',
                    '//instance/data/el2': 'v2',
                } );
                const expected = '<data><el1>v1</el1><el2>v2</el2></data>';

                expect( result ).to.equal( expected );
            } );

            it( 'preserves the model default when no instance default is provided', () => {
                const result = webformPrivate._prepareInstance( model, {
                    '//instance/data/el1': 'v1',
                } );
                const expected = '<data><el1>v1</el1><el2>default</el2></data>';

                expect( result ).to.equal( expected );
            } );

            it( 'does not return an instance string when no defaults are defined', () => {
                const result = webformPrivate._prepareInstance( model, {} );

                expect( result ).to.equal( null );
            } );

            it( 'does not return an instance string when no defaults object is provided', () => {
                const result = webformPrivate._prepareInstance( model );

                expect( result ).to.equal( null );
            } );

            it( 'does not populate inherited properties from defaults', () => {
                const proto = {
                    '//instance/data/el2': 'v2',
                };
                const defaults = Object.create( proto, {
                    '//instance/data/el1': {
                        enumerable: true,
                        value: 'v1',
                    },
                } );

                const result = webformPrivate._prepareInstance( model, defaults );
                const expected = '<data><el1>v1</el1><el2>default</el2></data>';

                expect( result ).to.equal( expected );
            } );
        } );

        describe( 'controller initialization', () => {
            const formTitle = 'Controller init form';
            const form = `<form autocomplete="off" novalidate="novalidate" class="or clearfix" dir="ltr" data-form-id="last-saved">\n<!--This form was created by transforming an ODK/OpenRosa-flavored (X)Form using an XSL stylesheet created by Enketo LLC.--><section class="form-logo"></section><h3 dir="auto" id="form-title">${formTitle}</h3>\n  \n\n  \n    <label class="question non-select "><span lang="" class="question-label active">Last saved...: <span class="or-output" data-value="instance('last-saved')/data/item"> </span></span><input type="text" name="/data/item" data-type-xml="string" data-setvalue="instance('last-saved')/data/item" data-event="odk-instance-first-load"></label>\n  \n<fieldset id="or-setvalue-items" style="display:none;"></fieldset></form>`;
            const model = '<instance><data><el1/><el2>default</el2></data><meta><instanceID/></meta></instance>';

            /** @type {import('../../app/models/survey-model').SurveyExternalData} */
            let externalData;

            /** @type {Survey} */
            let survey;

            /** @type {string[]} */
            let controllerFormLanguages;

            /** @type {Stub} */
            let controllerInitStub;

            /** @type {HTMLElement} */
            let formHeader;

            beforeEach( () => {
                controllerFormLanguages = [];

                controllerInitStub = sandbox.stub( controller, 'init' ).callsFake( () => Promise.resolve( {
                    languages: controllerFormLanguages,
                } ) );

                formHeader = document.querySelector(
                    webformPrivate.FORM_HEADER_SELECTOR
                );

                externalData = [
                    {
                        id: 'any',
                        src: 'https://example.com/any.xml',
                        xml: '<any/>',
                    },
                ];

                survey = {
                    ...baseSurvey,
                    form,
                    model,
                    externalData,
                };

                // Sinon cannot stub nonexistent properties
                if ( !( 'print' in settings ) ) {
                    settings['print'] = false;
                }
            } );

            it( 'appends the DOM representation of the survey\'s form after the page\'s form header', async () => {
                await webformPrivate._init( survey );

                const formElement = formHeader.nextSibling;

                expect( formElement.outerHTML ).to.deep.equal( form );
            } );

            it( 'initializes the controller with the form element and survey data', async () => {
                await webformPrivate._init( survey );

                const formElement = formHeader.nextSibling;

                expect( controllerInitStub ).to.have.been.calledWith( formElement, {
                    modelStr: model,
                    instanceStr: null,
                    external: externalData,
                    survey,
                } );
            } );

            it( 'initializes the controller with instance data with defaults from settings', async () => {
                sandbox.stub( settings, 'defaults' ).get( () => ( {
                    '//instance/data/el1': 'v1',
                } ) );

                await webformPrivate._init( survey );

                const formElement = formHeader.nextSibling;

                expect( controllerInitStub ).to.have.been.calledWith( formElement, {
                    modelStr: model,
                    instanceStr: '<data><el1>v1</el1><el2>default</el2></data>',
                    external: externalData,
                    survey,
                } );
            } );

            it( 'sets the page title with the title from the form', async () => {
                await webformPrivate._init( survey );

                const title = document.querySelector( 'title' );

                expect( title.textContent ).to.equal( formTitle );
            } );

            it( 'applies print styles if print is enabled in settings', async () => {
                sandbox.stub( settings, 'print' ).get( () => true );

                const applyPrintStyleStub = sandbox.stub( gui, 'applyPrintStyle' ).returns();

                await webformPrivate._init( survey );

                expect( applyPrintStyleStub ).to.have.been.called;
            } );

            it( 'does not apply print styles if print is not enabled in settings', async () => {
                sandbox.stub( settings, 'print' ).get( () => false );

                const applyPrintStyleStub = sandbox.stub( gui, 'applyPrintStyle' ).returns();

                await webformPrivate._init( survey );

                expect( applyPrintStyleStub ).not.to.have.been.called;
            } );

            it( 'localizes the form element', async () => {
                /** @type {Stub} */
                let queryStub;

                controllerInitStub.callsFake( async ( formElement ) => {
                    // Tests that `localize` from `translator.js` was called by inference
                    // without testing that entire functionality.
                    queryStub = sandbox.stub( formElement, 'querySelectorAll' ).returns( [] );

                    return survey;
                } );


                await webformPrivate._init( survey );

                expect( queryStub ).to.have.been.calledWith( '[data-i18n]' );
            } );

            it( 'returns a survey with ', async () => {
                controllerFormLanguages = [ 'ar', 'fa' ];

                const result = await webformPrivate._init( survey );

                expect( result ).to.deep.equal( {
                    ...survey,

                    languages: controllerFormLanguages,
                } );
            } );
        } );
    } );
} );
