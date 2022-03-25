/* eslint-disable no-unused-vars */
/* eslint-disable node/no-extraneous-require */
/* eslint-disable no-undef */

const { parseUnits } = require("@ethersproject/units");
const SuperfluidSDK = require("@superfluid-finance/js-sdk");
const ISuperTokenFactory = require("@superfluid-finance/ethereum-contracts/build/contracts/ISuperTokenFactory");
const ISuperfluid = require("@superfluid-finance/ethereum-contracts/build/contracts/ISuperfluid");
const IConstantFlowAgreementV1 = require("@superfluid-finance/ethereum-contracts/build/contracts/IConstantFlowAgreementV1");
const ISuperToken = require("@superfluid-finance/ethereum-contracts/build/contracts/ISuperToken");
const TestToken = require("@superfluid-finance/ethereum-contracts/build/contracts/TestToken");
const NativeSuperTokenProxy = require("@superfluid-finance/ethereum-contracts/build/contracts/NativeSuperTokenProxy");
const deployFramework = require("@superfluid-finance/ethereum-contracts/scripts/deploy-framework");
const deployTestToken = require("@superfluid-finance/ethereum-contracts/scripts/deploy-test-token");
const deploySuperToken = require("@superfluid-finance/ethereum-contracts/scripts/deploy-super-token");
const zeroAddress = "0x0000000000000000000000000000000000000000";
const helper = require("./../helpers/helpers");
const { getSeconds, expectedRevert } = require("../helpers/helpers");

const MIN_LOWER = 2;
const MIN_UPPER = 7;

let accounts, owner, user, streamReceiver;
let sf, dai, daix, host, cfa, nativeToken, strollManager;
const errorHandler = (err) => {
  if (err) throw err;
};

const getIndex = (user, superToken, liquidityToken) => {
  const encodedData = ethers.utils.defaultAbiCoder.encode(
    ["address", "address", "address"],
    [user, superToken, liquidityToken]
  );
  return ethers.utils.keccak256(encodedData);
};

const createStream = async (supertoken, sender, receiver, flowRate) => {
  const cfaInterface = new ethers.utils.Interface(IConstantFlowAgreementV1.abi);
  const callData = cfaInterface.encodeFunctionData("createFlow", [
    supertoken.address,
    receiver.address,
    flowRate,
    "0x",
  ]);
  await host.connect(sender).callAgreement(cfa.address, callData, "0x");
};

const deleteStream = async (supertoken, sender, receiver) => {
  const cfaInterface = new ethers.utils.Interface(IConstantFlowAgreementV1.abi);
  const callData = cfaInterface.encodeFunctionData("deleteFlow", [
    supertoken.address,
    sender.address,
    receiver.address,
    "0x",
  ]);
  await host.connect(sender).callAgreement(cfa.address, callData, "0x");
};

before(async () => {
  accounts = await ethers.getSigners();
  owner = accounts[0];
  user = accounts[3];
  streamReceiver = accounts[4];
  // Deploy SF and needed tokens
  await deployFramework(errorHandler, {
    web3,
    from: accounts[0].address,
    newTestResolver: true,
  });
  await deployTestToken(errorHandler, [":", "fDAI"], {
    web3,
    from: accounts[0].address,
  });
  await deploySuperToken(errorHandler, [":", "fDAI"], {
    web3,
    from: accounts[0].address,
  });
  sf = new SuperfluidSDK.Framework({
    web3,
    version: "test",
    tokens: ["fDAI"],
  });
  await sf.initialize();
  // get dai/daix as ethers
  daix = new ethers.Contract(sf.tokens.fDAIx.address, ISuperToken.abi, owner);
  dai = new ethers.Contract(sf.tokens.fDAI.address, TestToken.abi, owner);
  host = new ethers.Contract(sf.host.address, ISuperfluid.abi, owner);
  cfa = new ethers.Contract(
    sf.agreements.cfa.address,
    IConstantFlowAgreementV1.abi,
    owner
  );

  strollerFactory = await ethers.getContractFactory("ERC20StrollOut", owner);
  strollManagerFactory = await ethers.getContractFactory(
    "StrollManager",
    owner
  );
  strollManager = await strollManagerFactory.deploy(
    sf.agreements.cfa.address,
    MIN_LOWER,
    MIN_UPPER
  );
  strategy = await strollerFactory.deploy(strollManager.address);
  const superTokenFactoryAddress = await sf.host.getSuperTokenFactory();
  superTokenFactory = new ethers.Contract(
    superTokenFactoryAddress,
    ISuperTokenFactory.abi,
    accounts[0]
  );
  const tokenProxyFactory = new ethers.ContractFactory(
    NativeSuperTokenProxy.abi,
    NativeSuperTokenProxy.bytecode,
    accounts[0]
  );
  const _native = await tokenProxyFactory.deploy();
  await _native.initialize("abc", "abc", "1");
  await superTokenFactory.initializeCustomSuperToken(_native.address);
  nativeToken = new ethers.Contract(
    _native.address,
    ISuperToken.abi,
    accounts[0]
  );

  await dai.mint(user.address, parseUnits("1000", 18));
});

beforeEach(async () => {
  strollManager = await strollManagerFactory.deploy(
    sf.agreements.cfa.address,
    MIN_LOWER,
    MIN_UPPER
  );
  strategy = await strollerFactory.deploy(strollManager.address);
  await strollManager.addApprovedStrategy(strategy.address);
});

describe("#0 - StrollManager: Deployment and configurations", function () {
  it("Case #0.1 - Should deploy Manager with correct data", async () => {
    const minLower = await strollManager.minLower();
    const minUpper = await strollManager.minUpper();
    const cfaAddress = await strollManager.CFA_V1();
    const strollOwner = await strollManager.owner();
    assert.equal(minLower, MIN_LOWER, "minLower is not correct");
    assert.equal(minUpper, MIN_UPPER, "minUpper is not correct");
    assert.equal(cfaAddress, sf.agreements.cfa.address, "cfa is not correct");
    assert.equal(strollOwner, owner.address, "Owner is not correct");
  });
});

describe("#2 - StrollManager: add, remove, check strategies", function () {
  it("Case #2.1 - Should register strategy", async () => {
    // reset manager
    strollManager = await strollManagerFactory.deploy(
      sf.agreements.cfa.address,
      MIN_LOWER,
      MIN_UPPER
    );
    const tx = await strollManager.addApprovedStrategy(strategy.address);
    const strategyEvent = await helper.getEvents(tx, "AddedApprovedStrategy");
    assert.equal(
      strategyEvent[0].args.strategy,
      strategy.address,
      "wrong strategy"
    );
  });
  it("Case #2.2 - Should not register empty strategy", async () => {
    const rightError = await helper.expectedRevert(
      strollManager.connect(owner).addApprovedStrategy(zeroAddress),
      "empty strategy"
    );
    assert.ok(rightError);
  });
  it("Case #2.2 - Should check if strategy is approved", async () => {
    // reset manager
    strollManager = await strollManagerFactory.deploy(
      sf.agreements.cfa.address,
      MIN_LOWER,
      MIN_UPPER
    );
    await strollManager.addApprovedStrategy(strategy.address);
    const isOk = await strollManager.isApprovedStrategy(strategy.address);
    assert.ok(isOk);
  });
  it("Case #2.3 - Should remove register strategy", async () => {
    await strollManager.addApprovedStrategy(strategy.address);
    const tx = await strollManager.removeApprovedStrategy(strategy.address);
    const strategyEvent = await helper.getEvents(tx, "RemovedApprovedStrategy");
    assert.equal(
      strategyEvent[0].args.strategy,
      strategy.address,
      "wrong strategy"
    );
    // removing a non existing strategy should not revert
    await strollManager.removeApprovedStrategy(strategy.address);
  });
  it("Case #2.4 - Only owner can add/remove strategy", async () => {
    // reset manager
    strollManager = await strollManagerFactory.deploy(
      sf.agreements.cfa.address,
      MIN_LOWER,
      MIN_UPPER
    );
    const notOwnerRevertAdding = await helper.expectedRevert(
      strollManager.connect(user).addApprovedStrategy(strategy.address),
      "caller is not the owner"
    );
    const notOwnerRevertRemoving = await helper.expectedRevert(
      strollManager.connect(user).removeApprovedStrategy(strategy.address),
      "caller is not the owner"
    );
    assert.ok(notOwnerRevertAdding && notOwnerRevertRemoving);
  });
});

describe("#3 - StrollManager: Register TopUps", function () {
  it("Case #3.1 - Should not register top up without correct data", async () => {
    // reset manager
    strollManager = await strollManagerFactory.deploy(
      sf.agreements.cfa.address,
      MIN_LOWER,
      MIN_UPPER
    );
    const expiry = helper.getTimeStampNow() + 3600 * 24 * 30;
    const superTokenRevert = await helper.expectedRevert(
      strollManager.createTopUp(
        zeroAddress,
        strategy.address,
        dai.address,
        expiry,
        MIN_LOWER,
        MIN_UPPER
      ),
      "Null Address"
    );
    const strategyRevert = await helper.expectedRevert(
      strollManager.createTopUp(
        daix.address,
        zeroAddress,
        dai.address,
        expiry,
        MIN_LOWER,
        MIN_UPPER
      ),
      "Null Address"
    );
    const tokenRevert = await helper.expectedRevert(
      strollManager.createTopUp(
        daix.address,
        strategy.address,
        zeroAddress,
        expiry,
        MIN_LOWER,
        MIN_UPPER
      ),
      "Null Address"
    );
    const expiryRevert = await helper.expectedRevert(
      strollManager.createTopUp(
        daix.address,
        strategy.address,
        dai.address,
        helper.getTimeStampNow() - 10,
        MIN_LOWER,
        MIN_UPPER
      ),
      "Invalid time"
    );

    const lowerLimitRevert = await helper.expectedRevert(
      strollManager.createTopUp(
        daix.address,
        strategy.address,
        dai.address,
        expiry,
        MIN_LOWER - 1,
        MIN_UPPER
      ),
      "Increase lower limit"
    );

    const upperLimitRevert = await helper.expectedRevert(
      strollManager.createTopUp(
        daix.address,
        strategy.address,
        dai.address,
        expiry,
        MIN_LOWER,
        MIN_UPPER - 1
      ),
      "Increase upper limit"
    );

    const strategyNotRegisterRevert = await helper.expectedRevert(
      strollManager.createTopUp(
        daix.address,
        strategy.address,
        dai.address,
        expiry,
        MIN_LOWER,
        MIN_UPPER
      ),
      "strategy not allowed"
    );
    await strollManager.addApprovedStrategy(strategy.address);
    const supportedSTRevert = await helper.expectedRevert(
      strollManager.createTopUp(
        nativeToken.address,
        strategy.address,
        dai.address,
        expiry,
        MIN_LOWER,
        MIN_UPPER
      ),
      "super token not supported"
    );

    assert.ok(superTokenRevert && strategyRevert && tokenRevert);
    assert.ok(expiryRevert);
    assert.ok(lowerLimitRevert);
    assert.ok(upperLimitRevert);
    assert.ok(strategyNotRegisterRevert);
    assert.ok(supportedSTRevert);
  });
  it("Case #3.2 - Should register correct topUp", async () => {
    const expiry = helper.getTimeStampNow() + 3600 * 24 * 30;
    const index = getIndex(user.address, daix.address, dai.address);
    const tx = await strollManager
      .connect(user)
      .createTopUp(
        daix.address,
        strategy.address,
        dai.address,
        expiry,
        MIN_LOWER,
        MIN_UPPER
      );
    const TopUpCreatedEvent = await helper.getEvents(tx, "TopUpCreated");
    assert.equal(TopUpCreatedEvent[0].args.id, index, "not index");
    assert.equal(TopUpCreatedEvent[0].args.user, user.address, "not user");
    assert.equal(
      TopUpCreatedEvent[0].args.superToken,
      daix.address,
      "not supertoken"
    );
    assert.equal(
      TopUpCreatedEvent[0].args.strategy,
      strategy.address,
      "not strategy"
    );
    assert.equal(
      TopUpCreatedEvent[0].args.liquidityToken,
      dai.address,
      "not liquidityToken"
    );
    assert.equal(TopUpCreatedEvent[0].args.expiry, expiry, "not expiry");
    assert.equal(
      TopUpCreatedEvent[0].args.lowerLimit,
      MIN_LOWER,
      "not lowerLimit"
    );
    assert.equal(
      TopUpCreatedEvent[0].args.upperLimit,
      MIN_UPPER,
      "not upperLimit"
    );
  });
  it("Case #3.3 - Should update topUp", async () => {
    const expiry = helper.getTimeStampNow() + 3600 * 24 * 30;
    await strollManager
      .connect(user)
      .createTopUp(
        daix.address,
        strategy.address,
        dai.address,
        expiry,
        MIN_LOWER,
        MIN_UPPER
      );

    await strollManager
      .connect(user)
      .createTopUp(
        daix.address,
        strategy.address,
        dai.address,
        expiry + 1000,
        20,
        20
      );
    const topUp = await strollManager.getTopUp(
      user.address,
      daix.address,
      dai.address
    );
    assert.equal(topUp.lowerLimit, 20, "wrong lowerLimit on update");
    assert.equal(topUp.upperLimit, 20, "wrong upperLimit on update");
    assert.equal(topUp.expiry, expiry + 1000, "wrong expiry on update");
  });
});

describe("#4 - StrollManager: Delete TopUps", function () {
  it("Case #4.1 - Should remove topUp - full parameters", async () => {
    const expiry = helper.getTimeStampNow() + 3600 * 24 * 30;
    const index = getIndex(user.address, daix.address, dai.address);
    await strollManager
      .connect(user)
      .createTopUp(
        daix.address,
        strategy.address,
        dai.address,
        expiry,
        MIN_LOWER,
        MIN_UPPER
      );
    const tx = await strollManager
      .connect(user)
      .deleteTopUp(user.address, daix.address, dai.address);
    const topUpDeletedEvent = await helper.getEvents(tx, "TopUpDeleted");
    assert.equal(topUpDeletedEvent[0].args.id, index, "wrong index");
    assert.equal(topUpDeletedEvent[0].args.user, user.address, "wrong user");
    assert.equal(
      topUpDeletedEvent[0].args.superToken,
      daix.address,
      "wrong superToken"
    );
    assert.equal(
      topUpDeletedEvent[0].args.strategy,
      strategy.address,
      "wrong strategy"
    );
    assert.equal(
      topUpDeletedEvent[0].args.liquidityToken,
      dai.address,
      "wrong liquidityToken"
    );
  });
  it("Case #4.2 - Should remove topUp - non user caller", async () => {
    const expiry = helper.getTimeStampNow() + 3600;
    await strollManager
      .connect(user)
      .createTopUp(
        daix.address,
        strategy.address,
        dai.address,
        expiry,
        MIN_LOWER,
        MIN_UPPER
      );
    helper.increaseTime(3600);
    await strollManager
      .connect(owner)
      .deleteTopUp(user.address, daix.address, dai.address);
    const topUp = await strollManager.getTopUp(
      user.address,
      daix.address,
      dai.address
    );
    assert.equal(topUp.user, zeroAddress, "top up still registered");
    await helper.resetTime();
  });
  it("Case #4.3 - Should remove topUp - using batch", async () => {
    const anotherUser = accounts[5];
    const expiry = helper.getTimeStampNow() + 3600;
    const index1 = getIndex(user.address, daix.address, dai.address);
    const index2 = getIndex(anotherUser.address, daix.address, dai.address);
    await strollManager
      .connect(user)
      .createTopUp(
        daix.address,
        strategy.address,
        dai.address,
        expiry,
        MIN_LOWER,
        MIN_UPPER
      );

    await strollManager
      .connect(anotherUser)
      .createTopUp(
        daix.address,
        strategy.address,
        dai.address,
        expiry,
        MIN_LOWER,
        MIN_UPPER
      );
    helper.increaseTime(3600);
    await strollManager.connect(owner).deleteBatch([index1, index2]);
    const topUp1 = await strollManager.getTopUp(
      user.address,
      daix.address,
      dai.address
    );
    const topUp2 = await strollManager.getTopUp(
      anotherUser.address,
      daix.address,
      dai.address
    );
    assert.equal(topUp1.user, zeroAddress, "user 1 - top up still registered");
    assert.equal(topUp2.user, zeroAddress, "user 2 - top up still registered");
    await helper.resetTime();
  });
  it("Case #4.4 - Should not remove topUp - wrong user", async () => {
    const expiry = helper.getTimeStampNow() + 3600 * 24 * 30;
    await strollManager
      .connect(user)
      .createTopUp(
        daix.address,
        strategy.address,
        dai.address,
        expiry,
        MIN_LOWER,
        MIN_UPPER
      );

    const rightError = await helper.expectedRevert(
      strollManager
        .connect(owner)
        .deleteTopUp(user.address, daix.address, dai.address),
      "Can't delete TopUp"
    );
    assert.ok(rightError);
  });
  it("Case #4.5 - Should not remove topUp - wrong expiry", async () => {
    const expiry = helper.getTimeStampNow() + 3600;
    await strollManager
      .connect(user)
      .createTopUp(
        daix.address,
        strategy.address,
        dai.address,
        expiry,
        MIN_LOWER,
        MIN_UPPER
      );

    const rightError = await helper.expectedRevert(
      strollManager
        .connect(owner)
        .deleteTopUp(user.address, daix.address, dai.address),
      "Can't delete TopUp"
    );
    assert.ok(rightError);
  });
});

describe("#5 - TopUps", function () {
  it("Case #5.1 - checkTopUp", async () => {
    await strollManager
      .connect(user)
      .createTopUp(
        daix.address,
        strategy.address,
        dai.address,
        helper.getTimeStampNow() + helper.getSeconds(365),
        getSeconds(5),
        getSeconds(5)
      );

    // approve superToken
    await dai.connect(user).approve(daix.address, parseUnits("100", 18));
    // approve strategy
    await dai.connect(user).approve(strategy.address, parseUnits("100", 18));
    // get some superToken
    await daix.connect(user).upgrade(parseUnits("10", 18));
    await createStream(daix, user, streamReceiver, "100000000000000", "0x");
    const expected = 100000000000000 * getSeconds(5);
    await helper.increaseTime(3600 * 24 * 5);
    const amount = await strollManager.checkTopUp(
      user.address,
      daix.address,
      dai.address
    );
    assert.equal(amount, expected, "amount is wrong");
  });
  it("Case #5.2 - checkTopUp without stream", async () => {
    await deleteStream(daix, user, streamReceiver, "100000000000000", "0x");
    await strollManager
      .connect(user)
      .createTopUp(
        daix.address,
        strategy.address,
        dai.address,
        helper.getTimeStampNow() + helper.getSeconds(365),
        getSeconds(5),
        getSeconds(5)
      );
    const amount = await strollManager.checkTopUp(
      user.address,
      daix.address,
      dai.address
    );
    assert.equal(amount, 0, "amount should be zero");
  });
  it("Case #5.3 - checkTopUp without data should return zero", async () => {
    const amount = await strollManager.checkTopUp(
      user.address,
      daix.address,
      dai.address
    );
    assert.equal(amount, 0, "amount should be zero");
  });
  it("Case #5.4 - checkTopUp without approved balance", async () => {
    await strollManager
      .connect(user)
      .createTopUp(
        daix.address,
        strategy.address,
        dai.address,
        helper.getTimeStampNow() + helper.getSeconds(365),
        getSeconds(5),
        getSeconds(5)
      );
    // remove approval
    await dai.connect(user).approve(strategy.address, 0);
    // approve superToken
    await dai.connect(user).approve(daix.address, parseUnits("100", 18));
    // get some superToken
    await daix.connect(user).upgrade(parseUnits("10", 18));
    await createStream(daix, user, streamReceiver, "100000000000000", "0x");

    await helper.increaseTime(3600 * 24 * 5);
    const amount = await strollManager.checkTopUp(
      user.address,
      daix.address,
      dai.address
    );
    assert.equal(amount, 0, "amount is wrong");
  });
  it("Case #5.5 - checkTopUp without balance", async () => {
    await deleteStream(daix, user, streamReceiver, "100000000000000", "0x");
    await strollManager
      .connect(user)
      .createTopUp(
        daix.address,
        strategy.address,
        dai.address,
        helper.getTimeStampNow() + helper.getSeconds(365),
        getSeconds(5),
        getSeconds(5)
      );

    // approve superToken
    await dai.connect(user).approve(daix.address, parseUnits("100", 18));
    // approve strategy
    await dai.connect(user).approve(strategy.address, parseUnits("100", 18));
    // get some superToken
    await daix.connect(user).upgrade(parseUnits("10", 18));
    // remove dai balance
    const balance = await dai.balanceOf(user.address);
    await dai.connect(user).transfer(owner.address, balance);
    await createStream(daix, user, streamReceiver, "100000000000000", "0x");
    await helper.increaseTime(3600 * 24 * 5);
    const amount = await strollManager.checkTopUp(
      user.address,
      daix.address,
      dai.address
    );
    assert.equal(amount, 0, "amount is wrong");
  });
  it("Case #5.6 - checkTopUp with netFlowPositive should return zero", async () => {
    await deleteStream(daix, user, streamReceiver, "100000000000000", "0x");
    await dai.mint(user.address, parseUnits("1000", 18));
    await dai.mint(streamReceiver.address, parseUnits("1000", 18));
    await strollManager
      .connect(streamReceiver)
      .createTopUp(
        daix.address,
        strategy.address,
        dai.address,
        helper.getTimeStampNow() + helper.getSeconds(365),
        getSeconds(5),
        getSeconds(5)
      );

    // approve superToken
    await dai.connect(user).approve(daix.address, parseUnits("100", 18));
    await dai
      .connect(streamReceiver)
      .approve(daix.address, parseUnits("100", 18));

    // approve strategy
    await dai
      .connect(streamReceiver)
      .approve(strategy.address, parseUnits("100", 18));
    // get some superToken
    await daix.connect(user).upgrade(parseUnits("10", 18));
    await createStream(daix, user, streamReceiver, "100000000000000", "0x");
    await helper.increaseTime(3600 * 24 * 5);
    const amount = await strollManager.checkTopUp(
      streamReceiver.address,
      daix.address,
      dai.address
    );
    assert.equal(amount, 0, "amount is wrong");
  });
  it("Case #5.7 - checkTopUp with larger superToken balance should return zero", async () => {
    await deleteStream(daix, user, streamReceiver, "100000000000000", "0x");
    await strollManager
      .connect(user)
      .createTopUp(
        daix.address,
        strategy.address,
        dai.address,
        helper.getTimeStampNow() + helper.getSeconds(365),
        getSeconds(5),
        getSeconds(5)
      );

    // approve superToken
    await dai.connect(user).approve(daix.address, parseUnits("100", 18));
    // approve strategy
    await dai.connect(user).approve(strategy.address, parseUnits("100", 18));
    // get some superToken
    await daix.connect(user).upgrade(parseUnits("10", 18));

    await createStream(daix, user, streamReceiver, "100000000000000", "0x");
    await helper.increaseTime(3600 * 24 * 5);
    // mint and send tokens to user
    await dai.mint(owner.address, parseUnits("1000", 18));
    await dai.connect(owner).approve(daix.address, parseUnits("100", 18));
    await daix
      .connect(owner)
      .upgradeTo(user.address, parseUnits("100", 18), "0x");
    const amount = await strollManager.checkTopUp(
      user.address,
      daix.address,
      dai.address
    );
    assert.equal(amount, 0, "amount is wrong");
  });
});

describe("#6 - peform Top Up", function () {
  it("Case #6.1 - TopUp", async () => {
    await deleteStream(daix, user, streamReceiver, "100000000000000", "0x");
    await strollManager
      .connect(user)
      .createTopUp(
        daix.address,
        strategy.address,
        dai.address,
        helper.getTimeStampNow() + helper.getSeconds(365),
        getSeconds(5),
        getSeconds(5)
      );

    // approve superToken
    await dai.connect(user).approve(daix.address, parseUnits("100", 18));
    // approve strategy
    await dai.connect(user).approve(strategy.address, parseUnits("100", 18));
    // get some superToken
    await daix.connect(user).upgrade(parseUnits("10", 18));
    await createStream(daix, user, streamReceiver, "100000000000000", "0x");

    await helper.increaseTime(3600 * 24 * 5);
    const balance = await daix.balanceOf(user.address);
    const tx = await strollManager.performTopUp(
      user.address,
      daix.address,
      dai.address
    );
    await helper.getEvents(tx, "PerformedTopUp");
    const after = await daix.balanceOf(user.address);
    assert.isAbove(after, balance, "balance should go up");
  });
  it("Case #6.2 - should revert if no topAmount", async () => {
    await deleteStream(daix, user, streamReceiver, "100000000000000", "0x");
    await expectedRevert(
      strollManager.performTopUp(user.address, daix.address, dai.address),
      "TopUp check failed"
    );
  });
});
