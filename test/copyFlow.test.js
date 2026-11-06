const assert = require('assert');
const React = require('react');
const sinon = require('sinon');
const cssLoader = require.extensions['.css'];
require.extensions['.css'] = () => {};
const Start = require('../src/views/Start').default;
if (cssLoader) require.extensions['.css'] = cssLoader;
else delete require.extensions['.css'];
const SelectFolder = require('../src/components/SelectFolder').default;
const Page = require('../src/components/Page').default;
const RaisedButton = require('material-ui/RaisedButton').default;
const FlatButton = require('material-ui/FlatButton').default;
const { RadioButtonGroup } = require('material-ui/RadioButton');

function mountState(component) {
  component.setState = update => Object.assign(component.state, update);
  return component;
}

function find(element, predicate) {
  if (!React.isValidElement(element)) return;
  if (predicate(element)) return element;
  let result;
  React.Children.forEach(element.props.children, child => {
    result = result || find(child, predicate);
  });
  return result;
}

function pageButton(start, step, type, label) {
  const page = find(
    start.render(),
    el => el.type === Page && el.props.stepNum === step
  );
  return find(page, el => el.type === type && el.props.label === label);
}

describe('Copy wizard UX', function() {
  let start;
  beforeEach(function() {
    start = mountState(new Start());
    start.handleFolderSelect('source', 'Original', 'parent');
  });

  it('keeps the source and copy name when going back', function() {
    start.state.stepNum = 1;
    start.state.destFolderName = 'My copy';
    pageButton(start, 1, FlatButton, 'Go back').props.onClick();
    assert.equal(start.state.stepNum, 0);
    assert.equal(start.state.srcFolderID, 'source');
    assert.equal(start.state.destFolderName, 'My copy');
  });

  it('lets users edit the review without starting over', function() {
    start.state.stepNum = 3;
    pageButton(start, 3, FlatButton, 'Go back').props.onClick();
    assert.equal(start.state.stepNum, 2);
  });

  it('renders the saved destination option after returning to options', function() {
    start.state.copyTo = 'root';
    const group = find(start.render(), el => el.type === RadioButtonGroup);
    assert.equal(group.props.valueSelected, 'root');
  });

  it('blocks blank copy names but accepts a nonblank name', function() {
    start.state.stepNum = 1;
    start.state.destFolderName = '   ';
    assert(pageButton(start, 1, RaisedButton, 'Next').props.disabled);
    start.nextView();
    assert.equal(start.state.stepNum, 1);
    start.state.destFolderName = 'My copy';
    assert(!pageButton(start, 1, RaisedButton, 'Next').props.disabled);
    start.nextView();
    assert.equal(start.state.stepNum, 2);
  });

  it('requires a custom destination only when custom is selected', function() {
    start.state.stepNum = 2;
    start.state.copyTo = 'custom';
    assert(pageButton(start, 2, RaisedButton, 'Next').props.disabled);
    start.nextView();
    assert.equal(start.state.stepNum, 2);
    start.handleDestFolderSelect('destination', 'Destination');
    assert(!pageButton(start, 2, RaisedButton, 'Next').props.disabled);
    start.nextView();
    assert.equal(start.state.stepNum, 3);
    start.state.stepNum = 2;
    start.state.copyTo = 'root';
    start.state.destParentID = '';
    assert(!pageButton(start, 2, RaisedButton, 'Next').props.disabled);
  });

  it('clears prior options and names when explicitly starting over', function() {
    start.state.copyPermissions = true;
    start.handleDestFolderSelect('destination', 'Destination');
    start.reset();
    assert.equal(start.state.stepNum, 0);
    ['srcFolderID', 'srcParentID', 'destFolderName', 'destParentID'].forEach(
      key => {
        assert.equal(start.state[key], '');
      }
    );
    assert.equal(start.state.copyTo, 'same');
    assert.equal(start.state.copyPermissions, false);
  });
});

describe('Folder URL entry', function() {
  let selector, clock, selected, processing;
  beforeEach(function() {
    clock = sinon.useFakeTimers();
    selector = mountState(new SelectFolder());
    selected = sinon.spy();
    processing = sinon.spy();
    selector.props = {
      handleFolderSelect: selected,
      processing,
      reset: sinon.spy()
    };
  });
  afterEach(function() {
    clock.restore();
  });

  it('allows typing and submitting a trimmed folder URL', function() {
    selector.handleChange({
      target: { value: '  https://drive.google.com/drive/folders/source  ' }
    });
    assert.equal(
      selector.state.value,
      '  https://drive.google.com/drive/folders/source  '
    );
    const event = { preventDefault: sinon.spy() };
    selector.handleSubmit(event);
    assert(event.preventDefault.calledOnce);
    clock.tick(1000);
    assert(selected.calledWith('source', 'test mode folder', 'source'));
    assert.equal(selector.state.value, '');
  });

  it('preserves automatic selection when pasting a folder ID', function() {
    const event = {
      preventDefault: sinon.spy(),
      clipboardData: { getData: () => ' source ' }
    };
    selector.handlePaste(event);
    assert(event.preventDefault.calledOnce);
    clock.tick(1000);
    assert(selected.calledWith('source', 'test mode folder', 'source'));
  });

  it('does not start a lookup for empty input', function() {
    selector.handleChange({ target: { value: '  ' } });
    const button = find(
      selector.render(),
      el => el.props.label === 'Select folder'
    );
    assert(button.props.disabled);
    selector.handleSubmit({ preventDefault() {} });
    assert(!processing.called);
    clock.tick(1000);
    assert(!selected.called);
  });
});
